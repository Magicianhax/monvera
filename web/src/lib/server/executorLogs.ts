import "server-only";

// Server-side executor log scanning on Robinhood Chain (Vera's on-chain track
// record + per-user invest activity).
//
// Order of preference (mirrors walletTransfers.ts):
//   1. Blockscout `logs/getLogs` (robinhoodchain.blockscout.com — indexed,
//      keyless, Etherscan-compatible shape)
//   2. Chunked eth_getLogs over the RPC (fallback, <=9999 blocks per chunk)
// Results are cached in-memory for 60s so bursts never re-fan to the sources.
//
// Until the executor + registry contracts are redeployed on chain 4663, their
// env addresses default to zero and every reader short-circuits to an honest
// empty result (no pointless whole-chain scans).
import { createPublicClient, http, decodeEventLog, encodeEventTopics, padHex, zeroAddress } from "viem";
import type { AbiEvent } from "viem";
import { chain, EXPLORER_URL, RPC_URL } from "@/lib/chain";
import { kvCached as cached } from "@/lib/server/kvCache";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import {
  STAX_EXECUTOR,
  RECOMMENDATION_COMMITTED,
  ALLOCATION_EXECUTED,
  aggregateVeraRecord,
  toActivityRows,
  type RecommendationRow,
  type ExecutionRow,
  type VeraRecord,
  type ActivityRow,
} from "@/lib/onchainHistory";
import { IDENTITY_REGISTRY_ABI } from "@/lib/abis";

const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_STAX_EXECUTOR_BLOCK || "0");
const IDENTITY_REGISTRY = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || zeroAddress) as `0x${string}`;
const AGENT_ID = BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");

// Contracts not yet deployed on this chain -> nothing to scan.
const EXECUTOR_LIVE = STAX_EXECUTOR.toLowerCase() !== zeroAddress;
const REGISTRY_LIVE = IDENTITY_REGISTRY.toLowerCase() !== zeroAddress;

// Conservative public-RPC getLogs range cap.
const CHUNK = BigInt(9_999);
const CHUNK_CONCURRENCY = 5;

// Point reads (readContract, block number) go through the keyed endpoint;
// LOG SCANS stay on the public RPC — Alchemy's free tier caps eth_getLogs at a
// 10-block range, which no scan strategy survives.
const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });
const logsClient = createPublicClient({ chain, transport: http(RPC_URL) });

// Cross-isolate cache (memory + Cloudflare KV, lib/server/kvCache). Isolates
// recycle constantly and a cold one used to repay the FULL record scan (~60s
// when Blockscout flaked and the chunked public-RPC sweep ran). With KV the
// fleet shares one scan per TTL, and stale values survive a source outage.

// ── 1) Blockscout logs (indexed; keyless; Etherscan-compatible response) ──────
interface EsLog {
  topics: `0x${string}`[];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: `0x${string}`;
}

async function blockscoutLogs(event: AbiEvent, user?: `0x${string}`): Promise<EsLog[]> {
  const topic0 = encodeEventTopics({ abi: [event] })[0];
  const all: EsLog[] = [];
  // `user` is topic2 on both executor events (planId is topic1).
  const userFilter = user
    ? `&topic2=${padHex(user.toLowerCase() as `0x${string}`, { size: 32 })}&topic0_2_opr=and`
    : "";
  for (let page = 1; page <= 5; page++) {
    const url =
      `${EXPLORER_URL}/api?module=logs&action=getLogs` +
      `&address=${STAX_EXECUTOR}&topic0=${topic0}${userFilter}` +
      `&fromBlock=${DEPLOY_BLOCK}&toBlock=latest&page=${page}&offset=1000`;
    const res = await fetch(url);
    const json = (await res.json()) as { status: string; message: string; result: EsLog[] | string };
    if (!Array.isArray(json.result)) {
      // "No records found" is a clean empty, anything else is a real error.
      if (typeof json.message === "string" && json.message.toLowerCase().includes("no records")) break;
      throw new Error(typeof json.result === "string" ? json.result : json.message || "blockscout logs error");
    }
    all.push(...json.result);
    if (json.result.length < 1000) break;
  }
  return all;
}

// ── 2) chunked RPC scan over an explicit [from, to] range ─────────────────────
async function chunkedLogs(
  event: AbiEvent,
  user?: `0x${string}`,
  fromBlock?: bigint,
  toBlock?: bigint,
) {
  const latest = toBlock ?? (await logsClient.getBlockNumber());
  const start = fromBlock ?? DEPLOY_BLOCK;
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = start; from <= latest; from += CHUNK + BigInt(1)) {
    const to = from + CHUNK > latest ? latest : from + CHUNK;
    ranges.push({ from, to });
  }
  const out: Awaited<ReturnType<typeof logsClient.getLogs>> = [];
  for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((r) =>
        logsClient.getLogs({
          address: STAX_EXECUTOR,
          event,
          args: user ? { user } : undefined,
          fromBlock: r.from,
          toBlock: r.to,
        }),
      ),
    );
    for (const logs of results) out.push(...logs);
  }
  return out;
}

// ── decode + row mapping ──────────────────────────────────────────────────────
type DecodedArgs = Record<string, unknown>;

type EventRow = { args: DecodedArgs; txHash: `0x${string}`; blockNumber: bigint };

// getLogs with a runtime AbiEvent loses the decoded-args generic; the logs DO
// carry decoded args at runtime (viem decodes when `event` is passed).
function decodeChunked(
  logs: Awaited<ReturnType<typeof logsClient.getLogs>>,
): EventRow[] {
  return (logs as unknown as { args: DecodedArgs; transactionHash: `0x${string}`; blockNumber: bigint | null }[]).map((l) => ({
    args: l.args,
    txHash: l.transactionHash,
    blockNumber: l.blockNumber ?? BigInt(0),
  }));
}

// Only scan this far back from the head when supplementing Blockscout — a huge
// gap means Blockscout is cold, not lagging, and the full history is its job.
const TAIL_WINDOW = BigInt(60_000);

async function readEvent(event: AbiEvent, user?: `0x${string}`): Promise<EventRow[]> {
  if (!EXECUTOR_LIVE) return [];

  let rows: EventRow[];
  try {
    const raw = await blockscoutLogs(event, user);
    rows = raw.map((l) => {
      const { args } = decodeEventLog({ abi: [event], data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
      return { args: args as DecodedArgs, txHash: l.transactionHash, blockNumber: BigInt(l.blockNumber) };
    });
  } catch {
    // Blockscout down → full chunked RPC scan (historical fallback).
    return decodeChunked(await chunkedLogs(event, user));
  }

  // Blockscout's indexer can trail the chain head by thousands of blocks, so a
  // record written a few minutes ago is missing from its getLogs even though
  // it's on-chain. Supplement the tail straight from the RPC (which is at head)
  // and merge, so Vera's volume includes the most recent plans. Retry once — the
  // two parallel readEvent scans can briefly rate-limit the public RPC, and a
  // silent fallback here is what made the "recent plans" list flip-flop.
  const bsMax = rows.reduce((m, r) => (r.blockNumber > m ? r.blockNumber : m), DEPLOY_BLOCK);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const head = await logsClient.getBlockNumber();
      if (head <= bsMax) break;
      const from = bsMax + BigInt(1) > head - TAIL_WINDOW ? bsMax + BigInt(1) : head - TAIL_WINDOW;
      const tail = decodeChunked(await chunkedLogs(event, user, from, head));
      const seen = new Set(rows.map((r) => r.txHash.toLowerCase()));
      for (const r of tail) {
        if (!seen.has(r.txHash.toLowerCase())) {
          rows.push(r);
          seen.add(r.txHash.toLowerCase());
        }
      }
      break;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      // else: keep the Blockscout rows we already have
    }
  }
  return rows;
}

function usdToNumber(raw: bigint): number {
  return Number(raw) / 1e6;
}

async function readRecommendationRows(user?: `0x${string}`): Promise<RecommendationRow[]> {
  const rows = await readEvent(RECOMMENDATION_COMMITTED, user);
  return rows.map((r) => ({
    planId: r.args.planId as `0x${string}`,
    user: r.args.user as `0x${string}`,
    riskScore: Number(r.args.riskScore ?? 0),
    txHash: r.txHash,
    blockNumber: r.blockNumber,
  }));
}

async function readExecutionRows(user?: `0x${string}`): Promise<ExecutionRow[]> {
  const rows = await readEvent(ALLOCATION_EXECUTED, user);
  return rows.map((r) => ({
    planId: r.args.planId as `0x${string}`,
    user: r.args.user as `0x${string}`,
    usdcSpent: usdToNumber((r.args.usdcSpent as bigint) ?? BigInt(0)),
    legCount: Number(r.args.legCount ?? 0),
    txHash: r.txHash,
    blockNumber: r.blockNumber,
  }));
}

// ── public server API ─────────────────────────────────────────────────────────
export async function getVeraRecordServer(user?: `0x${string}`): Promise<VeraRecord> {
  return cached(`vera:${user ?? "global"}`, 60_000, async () => {
    const [recs, execs] = await Promise.all([readRecommendationRows(user), readExecutionRows(user)]);
    return aggregateVeraRecord(recs, execs);
  });
}

export async function getUserActivityServer(user: `0x${string}`): Promise<ActivityRow[]> {
  return cached(`activity:${user}`, 30_000, async () => {
    const execs = await readExecutionRows(user);
    return toActivityRows(execs);
  });
}

/** Vera's IdentityRegistry reputation score (single eth_call; cached 5 min). */
export async function getReputationServer(): Promise<bigint | null> {
  if (!REGISTRY_LIVE) return null;
  return cached("reputation", 300_000, async () => {
    try {
      const r = await client.readContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "reputationScore",
        args: [AGENT_ID],
      });
      return r as bigint;
    } catch {
      return null;
    }
  });
}
