// Reads Vera's REAL track record + a user's REAL activity straight from the
// StaxExecutor event log on Robinhood Chain. No off-chain database — the chain IS the
// record, which is exactly Vera's trust claim.
//
// Events (mirror the deployed StaxExecutor):
//   RecommendationCommitted(planId indexed, user indexed, recHash, riskScore, agentId)
//   AllocationExecuted(planId indexed, user indexed, usdcSpent, legCount)
//   LegFilled(planId indexed, tokenOut indexed, usdcIn, received)
//
// Vera's global record = every RecommendationCommitted + AllocationExecuted (she
// is the only advising agent, agentId 1). Per-user history filters by the indexed
// `user` topic. Everything degrades gracefully to a 0-state on empty history.
import type { PublicClient } from "viem";
import { parseAbiItem } from "viem";

const STAX_EXECUTOR = (process.env.NEXT_PUBLIC_STAX_EXECUTOR ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`; // pending 4663 redeploy

// First block the executor existed (contract creation) — bounds the log scan.
// Required via env (no hardcoded default): a redeploy that forgets to update this
// would otherwise silently scan from a stale block and under-report history.
const DEPLOY_BLOCK = process.env.NEXT_PUBLIC_STAX_EXECUTOR_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_STAX_EXECUTOR_BLOCK)
  : null;

function deployBlock(): bigint {
  if (DEPLOY_BLOCK === null) {
    throw new Error("NEXT_PUBLIC_STAX_EXECUTOR_BLOCK is not set — refusing to scan from an unknown block.");
  }
  return DEPLOY_BLOCK;
}

export const RECOMMENDATION_COMMITTED = parseAbiItem(
  "event RecommendationCommitted(bytes32 indexed planId, address indexed user, bytes32 recHash, uint16 riskScore, uint256 agentId)",
);
export const ALLOCATION_EXECUTED = parseAbiItem(
  "event AllocationExecuted(bytes32 indexed planId, address indexed user, uint256 usdcSpent, uint256 legCount)",
);

export interface RecommendationRow {
  planId: `0x${string}`;
  user: `0x${string}`;
  riskScore: number; // bps
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export interface ExecutionRow {
  planId: `0x${string}`;
  user: `0x${string}`;
  usdcSpent: number; // dollars (6dp -> number)
  legCount: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export interface VeraRecord {
  totalRecommendations: number;
  totalExecutedUsd: number;
  executedCount: number;
  /** Most-recent recommendations, newest first. */
  recentRecommendations: {
    planId: `0x${string}`;
    riskScore: number;
    /** USDC spent if this plan was also executed, else undefined. */
    usdcSpent?: number;
    txHash: `0x${string}`;
    blockNumber: bigint;
  }[];
}

function usdcToNumber(raw: bigint): number {
  return Number(raw) / 1e6;
}

/** Read all RecommendationCommitted logs (optionally for one user). */
async function readRecommendations(
  client: PublicClient,
  user?: `0x${string}`,
): Promise<RecommendationRow[]> {
  const logs = await client.getLogs({
    address: STAX_EXECUTOR,
    event: RECOMMENDATION_COMMITTED,
    args: user ? { user } : undefined,
    fromBlock: deployBlock(),
    toBlock: "latest",
  });
  return logs.map((l) => ({
    planId: l.args.planId as `0x${string}`,
    user: l.args.user as `0x${string}`,
    riskScore: Number(l.args.riskScore ?? 0),
    txHash: l.transactionHash as `0x${string}`,
    blockNumber: l.blockNumber ?? BigInt(0),
  }));
}

/** Read all AllocationExecuted logs (optionally for one user). */
async function readExecutions(
  client: PublicClient,
  user?: `0x${string}`,
): Promise<ExecutionRow[]> {
  const logs = await client.getLogs({
    address: STAX_EXECUTOR,
    event: ALLOCATION_EXECUTED,
    args: user ? { user } : undefined,
    fromBlock: deployBlock(),
    toBlock: "latest",
  });
  return logs.map((l) => ({
    planId: l.args.planId as `0x${string}`,
    user: l.args.user as `0x${string}`,
    usdcSpent: usdcToNumber(l.args.usdcSpent ?? BigInt(0)),
    legCount: Number(l.args.legCount ?? 0),
    txHash: l.transactionHash as `0x${string}`,
    blockNumber: l.blockNumber ?? BigInt(0),
  }));
}

/** Pure aggregation: rows -> the VeraRecord shape (shared by client + server). */
export function aggregateVeraRecord(
  recs: RecommendationRow[],
  execs: ExecutionRow[],
): VeraRecord {
  // Map executed USDC by planId (a plan can be committed once and executed once
  // in the same call, sharing planId).
  const spentByPlan = new Map<string, number>();
  for (const e of execs) {
    spentByPlan.set(e.planId, (spentByPlan.get(e.planId) ?? 0) + e.usdcSpent);
  }

  const totalExecutedUsd = execs.reduce((s, e) => s + e.usdcSpent, 0);

  const recentRecommendations = [...recs]
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, 8)
    .map((r) => ({
      planId: r.planId,
      riskScore: r.riskScore,
      usdcSpent: spentByPlan.get(r.planId),
      txHash: r.txHash,
      blockNumber: r.blockNumber,
    }));

  return {
    totalRecommendations: recs.length,
    totalExecutedUsd,
    executedCount: execs.length,
    recentRecommendations,
  };
}

/** Pure mapping: executions -> activity rows, newest first (shared client/server). */
export function toActivityRows(execs: ExecutionRow[]): ActivityRow[] {
  return execs
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .map((e) => ({
      kind: "invest" as const,
      usdc: e.usdcSpent,
      legCount: e.legCount,
      txHash: e.txHash,
      blockNumber: e.blockNumber,
    }));
}

/**
 * Vera's verifiable global track record (or scoped to `user` if provided).
 * Empty history yields a clean 0-state, never an error.
 *
 * NOTE: scans the FULL block range in one eth_getLogs — public RPCs cap that
 * range (public RPC 10k-block range cap), so browsers should use /api/vera-record
 * instead (Etherscan-indexed, cached). Kept for tooling/server use.
 */
export async function getVeraRecord(
  client: PublicClient,
  user?: `0x${string}`,
): Promise<VeraRecord> {
  const [recs, execs] = await Promise.all([
    readRecommendations(client, user),
    readExecutions(client, user),
  ]);
  return aggregateVeraRecord(recs, execs);
}

export interface ActivityRow {
  kind: "invest";
  usdc: number;
  legCount: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

/**
 * A user's Monvera on-chain activity (AllocationExecuted = AI invests), newest first.
 * Direct manual swaps go to the Fluxion/Agni router (not the executor) and aren't
 * attributable from the executor log, so they're intentionally not listed here —
 * the receipt screen still links a manual buy's own tx directly.
 */
export async function getUserActivity(
  client: PublicClient,
  user: `0x${string}`,
): Promise<ActivityRow[]> {
  const execs = await readExecutions(client, user);
  return toActivityRows(execs);
}

export { STAX_EXECUTOR };
