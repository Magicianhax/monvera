import "server-only";

// Rebalance history for one grove, straight from GroveManager's events — the
// panel on the grove page that answers "has anyone ever touched this basket,
// and when". Two kinds of touch exist and both are shown:
//
//   Rebalanced(user, groveId)                     — a member's basket realigned
//   CompositionUpdated(groveId, version, ...)     — the recipe itself changed
//
// Source order mirrors executorLogs.ts: Blockscout getLogs first (indexed,
// keyless), then a chunked public-RPC scan as fallback, plus an RPC tail
// supplement because Blockscout's indexer trails the head (execution rule 6).
// Log scans stay OFF the keyed endpoint — Alchemy caps eth_getLogs at 10
// blocks and bills the refusals (see the RPC-burn lessons).
import { createPublicClient, decodeEventLog, encodeEventTopics, http, parseAbiItem, toHex } from "viem";
import type { AbiEvent } from "viem";
import { chain, EXPLORER_URL, PUBLIC_RPC_URL } from "@/lib/chain";
import { kvCached } from "@/lib/server/kvCache";
import { GROVE_MANAGER } from "./groveQuote";

const REBALANCED = parseAbiItem("event Rebalanced(address indexed user, uint256 indexed groveId)");
const COMPOSITION_UPDATED = parseAbiItem(
  "event CompositionUpdated(uint256 indexed groveId, uint32 version, address[] tokens, uint16[] weightsBps)",
);

// The current GroveManager (0xf0b1a694…e5a6) was created in this block
// (tx 0x1d0b5b71…, 2026-07-27) — the floor for the RPC fallback scan, so a
// Blockscout outage never triggers a whole-chain sweep.
const DEPLOY_BLOCK = BigInt(process.env.GROVE_MANAGER_DEPLOY_BLOCK || "21036427");

const CHUNK = BigInt(9_999);
const CHUNK_CONCURRENCY = 5;
// Tail supplement only reaches this far behind the head — a bigger gap means
// Blockscout is cold, not lagging, and full history is its job.
const TAIL_WINDOW = BigInt(60_000);

const logsClient = createPublicClient({ chain, transport: http(PUBLIC_RPC_URL) });

export interface GroveHistoryRow {
  kind: "rebalance" | "composition";
  txHash: `0x${string}`;
  blockNumber: number;
  /** Unix seconds; null when no source carried a timestamp. */
  at: number | null;
  /** rebalance: whose basket was realigned. */
  user?: `0x${string}`;
  /** composition: recipe version after the change, and how many names it holds. */
  version?: number;
  names?: number;
}

export interface GroveHistory {
  /** Newest first. Empty is the honest launch state, not an error. */
  rows: GroveHistoryRow[];
  asOf: string;
}

interface EsLog {
  topics: `0x${string}`[];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: `0x${string}`;
  timeStamp?: `0x${string}`;
}

type RawRow = { args: Record<string, unknown>; txHash: `0x${string}`; blockNumber: bigint; at: number | null };

/** groveId is topic2 on Rebalanced (user is topic1) and topic1 on CompositionUpdated. */
function groveTopicPosition(event: AbiEvent): 1 | 2 {
  return event === REBALANCED ? 2 : 1;
}

async function blockscoutLogs(event: AbiEvent, onChainId: number): Promise<EsLog[]> {
  const topic0 = encodeEventTopics({ abi: [event] })[0];
  const pos = groveTopicPosition(event);
  const groveTopic = toHex(BigInt(onChainId), { size: 32 });
  const all: EsLog[] = [];
  for (let page = 1; page <= 5; page++) {
    const url =
      `${EXPLORER_URL}/api?module=logs&action=getLogs` +
      `&address=${GROVE_MANAGER}&topic0=${topic0}` +
      `&topic${pos}=${groveTopic}&topic0_${pos}_opr=and` +
      `&fromBlock=${DEPLOY_BLOCK}&toBlock=latest&page=${page}&offset=1000`;
    const res = await fetch(url);
    const json = (await res.json()) as { status: string; message: string; result: EsLog[] | string };
    if (!Array.isArray(json.result)) {
      if (typeof json.message === "string" && json.message.toLowerCase().includes("no records")) break;
      throw new Error(typeof json.result === "string" ? json.result : json.message || "blockscout logs error");
    }
    all.push(...json.result);
    if (json.result.length < 1000) break;
  }
  return all;
}

async function chunkedLogs(event: AbiEvent, onChainId: number, fromBlock?: bigint, toBlock?: bigint): Promise<RawRow[]> {
  const latest = toBlock ?? (await logsClient.getBlockNumber());
  const start = fromBlock ?? DEPLOY_BLOCK;
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = start; from <= latest; from += CHUNK + BigInt(1)) {
    ranges.push({ from, to: from + CHUNK > latest ? latest : from + CHUNK });
  }
  // Both events name their indexed grove arg `groveId` — viem filters by name.
  const args = { groveId: BigInt(onChainId) };
  const out: RawRow[] = [];
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        logsClient.getLogs({
          address: GROVE_MANAGER as `0x${string}`,
          event,
          args,
          fromBlock: r.from,
          toBlock: r.to,
        }),
      ),
    );
    for (const logs of results) {
      for (const l of logs as unknown as { args: Record<string, unknown>; transactionHash: `0x${string}`; blockNumber: bigint | null }[]) {
        out.push({ args: l.args, txHash: l.transactionHash, blockNumber: l.blockNumber ?? BigInt(0), at: null });
      }
    }
  }
  return out;
}

/** Fill missing timestamps from block headers — RPC logs don't carry them.
 *  Bounded: the tail window holds a handful of events at most. */
async function stampRows(rows: RawRow[]): Promise<void> {
  const missing = [...new Set(rows.filter((r) => r.at === null).map((r) => r.blockNumber))].slice(0, 12);
  if (!missing.length) return;
  const stamps = new Map<bigint, number>();
  await Promise.all(
    missing.map(async (bn) => {
      try {
        const b = await logsClient.getBlock({ blockNumber: bn });
        stamps.set(bn, Number(b.timestamp));
      } catch {
        /* a missing stamp shows as "—", never blocks the list */
      }
    }),
  );
  for (const r of rows) if (r.at === null) r.at = stamps.get(r.blockNumber) ?? null;
}

async function readEvent(event: AbiEvent, onChainId: number): Promise<RawRow[]> {
  let rows: RawRow[];
  try {
    const raw = await blockscoutLogs(event, onChainId);
    rows = raw.map((l) => {
      const { args } = decodeEventLog({ abi: [event], data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
      return {
        args: args as Record<string, unknown>,
        txHash: l.transactionHash,
        blockNumber: BigInt(l.blockNumber),
        at: l.timeStamp ? Number(BigInt(l.timeStamp)) : null,
      };
    });
  } catch {
    const all = await chunkedLogs(event, onChainId);
    await stampRows(all);
    return all;
  }

  // Blockscout trails the chain head — supplement the recent tail from the RPC
  // so a rebalance from minutes ago is already on the page (rule 6).
  const bsMax = rows.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), DEPLOY_BLOCK);
  try {
    const head = await logsClient.getBlockNumber();
    if (head > bsMax) {
      const from = bsMax + BigInt(1) > head - TAIL_WINDOW ? bsMax + BigInt(1) : head - TAIL_WINDOW;
      const tail = await chunkedLogs(event, onChainId, from, head);
      const seen = new Set(rows.map((r) => r.txHash.toLowerCase()));
      const fresh = tail.filter((r) => !seen.has(r.txHash.toLowerCase()));
      await stampRows(fresh);
      rows.push(...fresh);
    }
  } catch {
    /* keep the Blockscout rows we already have */
  }
  return rows;
}

/** Every on-chain touch of this grove, newest first (KV-cached ~2 min). */
export async function getGroveHistory(onChainId: number): Promise<GroveHistory> {
  if (!GROVE_MANAGER) return { rows: [], asOf: new Date().toISOString() };
  return kvCached(`grove-history:${onChainId}`, 120_000, async () => {
    const [rebalances, compositions] = await Promise.all([
      readEvent(REBALANCED, onChainId),
      readEvent(COMPOSITION_UPDATED, onChainId),
    ]);
    const rows: GroveHistoryRow[] = [
      ...rebalances.map((r) => ({
        kind: "rebalance" as const,
        txHash: r.txHash,
        blockNumber: Number(r.blockNumber),
        at: r.at,
        user: r.args.user as `0x${string}`,
      })),
      ...compositions.map((r) => ({
        kind: "composition" as const,
        txHash: r.txHash,
        blockNumber: Number(r.blockNumber),
        at: r.at,
        version: Number(r.args.version ?? 0),
        names: Array.isArray(r.args.tokens) ? (r.args.tokens as unknown[]).length : undefined,
      })),
    ].sort((a, b) => b.blockNumber - a.blockNumber);
    return { rows, asOf: new Date().toISOString() };
  });
}
