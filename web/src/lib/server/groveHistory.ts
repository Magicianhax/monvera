import "server-only";

// Rebalance history for one grove, straight from GroveManager's events — the
// panel on the grove page that answers "has anyone ever touched this basket,
// and when". Two kinds of touch exist and both are shown:
//
//   Rebalanced(user, groveId)                     — a member's basket realigned
//   CompositionUpdated(groveId, version, ...)     — the recipe itself changed
//
// Source order (learned in production, 2026-08-03):
//   1. Blockscout v2 address logs — ONE request returns the contract's whole
//      event log with block timestamps. The v1 logs module 429s Cloudflare's
//      shared egress IPs long before v2 does, and a v1 failure used to cascade
//      into a ~60-chunk public-RPC sweep that the RPC 429'd too → the route
//      500'd. v2 first makes the common path a single fetch.
//   2. v1 logs module (Etherscan shape) — fallback.
//   3. Chunked public-RPC scan from the deploy block — last resort, gentle
//      concurrency. Log scans stay OFF the keyed endpoint (Alchemy caps
//      eth_getLogs at 10 blocks and bills the refusals); point reads (head,
//      block stamps) use the keyed endpoint, sparing the public quota.
// Plus an RPC tail supplement on top of either Blockscout source — its indexer
// trails the head (execution rule 6), and a rebalance from minutes ago belongs
// on the page. Every Blockscout fetch sends a User-Agent: Workers' fetch sends
// none and WAFs reject that (the Kyber lesson).
import { createPublicClient, decodeEventLog, encodeEventTopics, http, parseAbiItem, toHex } from "viem";
import type { AbiEvent } from "viem";
import { chain, EXPLORER_URL, PUBLIC_RPC_URL } from "@/lib/chain";
import { kvCached } from "@/lib/server/kvCache";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { GROVE_MANAGER } from "./groveQuote";

const REBALANCED = parseAbiItem("event Rebalanced(address indexed user, uint256 indexed groveId)");
const COMPOSITION_UPDATED = parseAbiItem(
  "event CompositionUpdated(uint256 indexed groveId, uint32 version, address[] tokens, uint16[] weightsBps)",
);
const TOPIC_REBALANCED = encodeEventTopics({ abi: [REBALANCED] })[0];
const TOPIC_COMPOSITION = encodeEventTopics({ abi: [COMPOSITION_UPDATED] })[0];

// The current GroveManager (0xf0b1a694…e5a6) was created in this block
// (tx 0x1d0b5b71…, 2026-07-27) — the floor for the RPC fallback scan, so a
// Blockscout outage never triggers a whole-chain sweep.
const DEPLOY_BLOCK = BigInt(process.env.GROVE_MANAGER_DEPLOY_BLOCK || "21036427");

const CHUNK = BigInt(9_999);
// Gentle on purpose: the public RPC 429s Cloudflare egress fast, and this path
// only runs when both Blockscout sources are down.
const CHUNK_CONCURRENCY = 2;
// Tail supplement only reaches this far behind the head — a bigger gap means
// Blockscout is cold, not lagging, and full history is its job.
const TAIL_WINDOW = BigInt(60_000);

const HEADERS = {
  "user-agent": "monvera/1.0 (+https://monvera.best)",
  accept: "application/json",
} as const;

// Point reads on the keyed endpoint; LOG SCANS on the literal public URL.
const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });
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

type RawLog = {
  topics: `0x${string}`[];
  data: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  at: number | null;
};

/** groveId sits in topics[2] on Rebalanced (user is topics[1]), topics[1] on CompositionUpdated. */
function isForGrove(topics: `0x${string}`[], onChainId: number): boolean {
  const groveTopic = toHex(BigInt(onChainId), { size: 32 }).toLowerCase();
  if (topics[0] === TOPIC_REBALANCED) return topics[2]?.toLowerCase() === groveTopic;
  if (topics[0] === TOPIC_COMPOSITION) return topics[1]?.toLowerCase() === groveTopic;
  return false;
}

// ── 1) Blockscout v2: the whole contract log in one paginated request ─────────
interface V2Item {
  topics: (`0x${string}` | null)[];
  data: `0x${string}`;
  transaction_hash: `0x${string}`;
  block_number: number;
  block_timestamp?: string;
}

async function blockscoutV2Logs(onChainId: number): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let params = "";
  for (let page = 0; page < 6; page++) {
    const res = await fetch(`${EXPLORER_URL}/api/v2/addresses/${GROVE_MANAGER}/logs${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`blockscout v2 logs ${res.status}`);
    const json = (await res.json()) as { items?: V2Item[]; next_page_params?: Record<string, string | number> | null };
    for (const it of json.items ?? []) {
      const topics = (it.topics ?? []).filter((t): t is `0x${string}` => typeof t === "string");
      if (!isForGrove(topics, onChainId)) continue;
      const ts = it.block_timestamp ? Date.parse(it.block_timestamp) : NaN;
      out.push({
        topics,
        data: it.data,
        txHash: it.transaction_hash,
        blockNumber: BigInt(it.block_number),
        at: Number.isFinite(ts) ? Math.floor(ts / 1000) : null,
      });
    }
    const next = json.next_page_params;
    if (!next || Object.keys(next).length === 0) break;
    params = "?" + new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)])).toString();
  }
  return out;
}

// ── 2) v1 logs module (Etherscan shape) ───────────────────────────────────────
interface EsLog {
  topics: `0x${string}`[];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: `0x${string}`;
  timeStamp?: `0x${string}`;
}

async function blockscoutV1Logs(event: AbiEvent, onChainId: number): Promise<RawLog[]> {
  const topic0 = encodeEventTopics({ abi: [event] })[0];
  const pos = event === REBALANCED ? 2 : 1;
  const groveTopic = toHex(BigInt(onChainId), { size: 32 });
  const all: RawLog[] = [];
  for (let page = 1; page <= 5; page++) {
    const url =
      `${EXPLORER_URL}/api?module=logs&action=getLogs` +
      `&address=${GROVE_MANAGER}&topic0=${topic0}` +
      `&topic${pos}=${groveTopic}&topic0_${pos}_opr=and` +
      `&fromBlock=${DEPLOY_BLOCK}&toBlock=latest&page=${page}&offset=1000`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`blockscout v1 logs ${res.status}`);
    const json = (await res.json()) as { status: string; message: string; result: EsLog[] | string };
    if (!Array.isArray(json.result)) {
      if (typeof json.message === "string" && json.message.toLowerCase().includes("no records")) break;
      throw new Error(typeof json.result === "string" ? json.result : json.message || "blockscout logs error");
    }
    for (const l of json.result) {
      all.push({
        topics: l.topics,
        data: l.data,
        txHash: l.transactionHash,
        blockNumber: BigInt(l.blockNumber),
        at: l.timeStamp ? Number(BigInt(l.timeStamp)) : null,
      });
    }
    if (json.result.length < 1000) break;
  }
  return all;
}

// ── 3) chunked public-RPC scan over [from, to] ────────────────────────────────
async function chunkedLogs(onChainId: number, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = fromBlock; from <= toBlock; from += CHUNK + BigInt(1)) {
    ranges.push({ from, to: from + CHUNK > toBlock ? toBlock : from + CHUNK });
  }
  const out: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        logsClient.getLogs({ address: GROVE_MANAGER as `0x${string}`, fromBlock: r.from, toBlock: r.to }),
      ),
    );
    for (const logs of results) {
      for (const l of logs) {
        const topics = l.topics as `0x${string}`[];
        if (!isForGrove(topics, onChainId)) continue;
        out.push({
          topics,
          data: l.data,
          txHash: l.transactionHash,
          blockNumber: l.blockNumber ?? BigInt(0),
          at: null,
        });
      }
    }
  }
  return out;
}

/** Fill missing timestamps from block headers — RPC logs don't carry them.
 *  Point reads, so the KEYED endpoint. Bounded: a handful of blocks at most. */
async function stampRows(rows: RawLog[]): Promise<void> {
  const missing = [...new Set(rows.filter((r) => r.at === null).map((r) => r.blockNumber))].slice(0, 12);
  if (!missing.length) return;
  const stamps = new Map<bigint, number>();
  await Promise.all(
    missing.map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: bn });
        stamps.set(bn, Number(b.timestamp));
      } catch {
        /* a missing stamp shows as "—", never blocks the list */
      }
    }),
  );
  for (const r of rows) if (r.at === null) r.at = stamps.get(r.blockNumber) ?? null;
}

async function readAll(onChainId: number): Promise<RawLog[]> {
  let rows: RawLog[];
  let fromBlockscout = true;
  try {
    rows = await blockscoutV2Logs(onChainId);
  } catch {
    try {
      const [reb, comp] = await Promise.all([
        blockscoutV1Logs(REBALANCED, onChainId),
        blockscoutV1Logs(COMPOSITION_UPDATED, onChainId),
      ]);
      rows = [...reb, ...comp];
    } catch {
      fromBlockscout = false;
      const head = await client.getBlockNumber();
      rows = await chunkedLogs(onChainId, DEPLOY_BLOCK, head);
      await stampRows(rows);
    }
  }

  // Blockscout trails the chain head — supplement the recent tail from the RPC
  // so a rebalance from minutes ago is already on the page (rule 6). Failure
  // here keeps the rows we have; it never takes the panel down.
  if (fromBlockscout) {
    try {
      const head = await client.getBlockNumber();
      const bsMax = rows.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), DEPLOY_BLOCK);
      if (head > bsMax) {
        const from = bsMax + BigInt(1) > head - TAIL_WINDOW ? bsMax + BigInt(1) : head - TAIL_WINDOW;
        const tail = await chunkedLogs(onChainId, from, head);
        const seen = new Set(rows.map((r) => `${r.txHash}-${r.topics[0]}`.toLowerCase()));
        const fresh = tail.filter((r) => !seen.has(`${r.txHash}-${r.topics[0]}`.toLowerCase()));
        await stampRows(fresh);
        rows.push(...fresh);
      }
    } catch {
      /* keep the Blockscout rows we already have */
    }
  }
  return rows;
}

/** Every on-chain touch of this grove, newest first (KV-cached ~2 min). */
export async function getGroveHistory(onChainId: number): Promise<GroveHistory> {
  if (!GROVE_MANAGER) return { rows: [], asOf: new Date().toISOString() };
  return kvCached(`grove-history:${onChainId}`, 120_000, async () => {
    const raw = await readAll(onChainId);
    const rows: GroveHistoryRow[] = raw
      .map((r): GroveHistoryRow | null => {
        try {
          if (r.topics[0] === TOPIC_REBALANCED) {
            const { args } = decodeEventLog({ abi: [REBALANCED], data: r.data, topics: r.topics as [`0x${string}`, ...`0x${string}`[]] });
            return {
              kind: "rebalance" as const,
              txHash: r.txHash,
              blockNumber: Number(r.blockNumber),
              at: r.at,
              user: args.user,
            };
          }
          const { args } = decodeEventLog({ abi: [COMPOSITION_UPDATED], data: r.data, topics: r.topics as [`0x${string}`, ...`0x${string}`[]] });
          return {
            kind: "composition" as const,
            txHash: r.txHash,
            blockNumber: Number(r.blockNumber),
            at: r.at,
            version: Number(args.version ?? 0),
            names: Array.isArray(args.tokens) ? args.tokens.length : undefined,
          };
        } catch {
          return null; // one undecodable log never takes down the list
        }
      })
      .filter((r): r is GroveHistoryRow => r !== null)
      .sort((a, b) => b.blockNumber - a.blockNumber);
    return { rows, asOf: new Date().toISOString() };
  });
}
