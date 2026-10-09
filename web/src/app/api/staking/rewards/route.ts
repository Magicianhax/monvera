import "server-only";

// GET /api/staking/rewards?address=0x… — live season reward preview for one
// wallet: { seasonStarted, bankedSoFar, todayAccruing } (raw 18dp wei strings).
//
// Runs the SAME off-chain model as the final merkle payout (compute.ts) over the
// staking event stream up to the chain head, so the "Earned so far" / "This
// epoch, accruing" tiles show a number that grows from epoch 1 and, at close,
// equals what the claim manifest pays. The event scan is shared across the whole
// deployment via kvCached (stale-while-revalidate), so only the first reader per
// TTL ever pays for it.
import { isAddress } from "viem";
import { kvCached } from "@/lib/server/kvCache";
import { stakingAbi, stakingChain, stakingClient, stakingLogsClient } from "@/lib/staking";
import { fetchStakeEvents } from "@/lib/season/fetch";
import { previewFor, replayBalances, type StakeEvent } from "@/lib/season/compute";
import { SEASON1, DEPLOY_BLOCK, STAKING } from "@/lib/season/config";

export const dynamic = "force-dynamic";

interface EventSnapshot {
  events: StakeEvent[];
  headTs: bigint;
  /** Last block the events are complete through. Absent on pre-cursor entries. */
  toBlock?: bigint;
}

// The public 4663 RPC caps eth_getLogs at 10,000,000 blocks per call for the
// address-only filter fetch.ts sends (its own error text, measured 2026-10-09;
// an OR'd topic list drops that to 100k). fetch.ts halves if it ever tightens.
const LOG_SPAN = BigInt(10_000_000);

// RPC only, never the explorer: Blockscout now answers API clients with a
// Cloudflare challenge, and its history-only degrade would advance the cursor
// past events it never saw. Complete through `to`, or throw.
const scan = (from: bigint, to: bigint) =>
  from > to ? Promise.resolve([] as StakeEvent[]) : fetchStakeEvents(stakingLogsClient, STAKING, from, to, LOG_SPAN, { explorer: false });

/** Σ replayed staked balance == the contract's totalStaked (stake credits the
 *  measured delta it emits; requestUnstake/cancel move it 1:1). replayBalances
 *  also throws on any per-wallet stakedAfter mismatch, i.e. a dropped event. */
function reconciles(events: StakeEvent[], totalStaked: bigint): boolean {
  try {
    let sum = BigInt(0);
    for (const tl of replayBalances(events).values()) sum += tl.length ? tl[tl.length - 1].bal : BigInt(0);
    return sum === totalStaked;
  } catch {
    return false;
  }
}

// One shared scan per 30s for the whole fleet. INCREMENTAL: the history is
// ~66M blocks and grows ~1M/day, so rescanning it every refresh is what broke
// this (a fixed call budget outgrown by chain age). The previous snapshot is
// extended by just the blocks after its cursor; only a cold cache or a failed
// reconciliation pays for the full scan.
async function loadEvents(prev?: EventSnapshot): Promise<EventSnapshot> {
  const head = await stakingLogsClient.getBlockNumber();
  const headTs = (await stakingLogsClient.getBlock({ blockNumber: head })).timestamp;
  const totalStaked = await stakingClient.readContract({
    address: STAKING,
    abi: stakingAbi,
    functionName: "totalStaked",
    blockNumber: head,
  });

  const base = prev?.toBlock !== undefined && prev.toBlock <= head ? prev : undefined;
  let events = base ? [...base.events, ...(await scan(base.toBlock! + BigInt(1), head))] : await scan(DEPLOY_BLOCK, head);
  if (base && !reconciles(events, totalStaked)) {
    console.warn("[staking/rewards] incremental snapshot drifted from totalStaked — full rescan");
    events = await scan(DEPLOY_BLOCK, head);
  }

  // Sanity gate, same discipline as the season builder: a transient empty or
  // short getLogs is indistinguishable from "nobody staked", and caching it
  // would serve every staker a confident, WRONG number for 30s. Refuse the
  // snapshot instead — the caller reports unavailable and the UI shows "—",
  // which is honest, instead of a zero that reads as "you earned nothing".
  if (!reconciles(events, totalStaked)) {
    throw new Error(`reward scan does not reconcile with totalStaked=${totalStaked} — refusing snapshot`);
  }
  return { events, headTs, toBlock: head };
}

// The ?all=1 table is identical for every caller of the same event snapshot,
// but rebuilding it costs a replay per staker (O(stakers × events)) — with a
// whole leaderboard of pollers that recompute dominated the handler. One slot
// is enough: headTs pins the snapshot identity, so the memo naturally rolls
// over when kvCached serves a fresh scan and is shared until then.
let stakersMemo: {
  key: string;
  stakers: { address: string; staked: string; earned: string }[];
} | null = null;

export async function GET(req: Request): Promise<Response> {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return Response.json({ error: "valid ?address= required" }, { status: 400 });
  }
  // No season configured yet → the tiles stay "—" (client treats this as absent).
  if (SEASON1.seasonStart === BigInt(0)) {
    return Response.json({ seasonStarted: false });
  }
  try {
    const { events, headTs } = await kvCached<EventSnapshot>(
      `staking-rewards-events:${stakingChain.id}:${DEPLOY_BLOCK}`,
      30_000,
      loadEvents,
    );
    const p = previewFor(events, SEASON1, headTs, address as `0x${string}`);
    // ?all=1 returns the whole leaderboard: every staker, their current staked
    // balance and their earned figure.
    //
    // This exists because the browser CANNOT build the roster itself. The public
    // Robinhood RPC caps eth_getLogs at ~2000 blocks, and the contract is
    // ~900k blocks back, so a client-side scan from the deploy block is both
    // impossible in one call and absurd in chunks. Here the event stream is
    // already loaded and cached (KV, shared fleet-wide), the balances fall out
    // of the same replay, and previewFor is pure, so the whole table costs one
    // pass over a small in-memory array and zero extra chain reads.
    let stakers: { address: string; staked: string; earned: string }[] | undefined;
    if (new URL(req.url).searchParams.get("all") === "1") {
      const memoKey = `${headTs}:${events.length}`;
      if (stakersMemo?.key === memoKey) {
        stakers = stakersMemo.stakers;
      } else {
        const timelines = replayBalances(events);
        stakers = [...timelines.entries()]
          .map(([addr, tl]) => ({
            address: addr,
            staked: (tl.length ? tl[tl.length - 1].bal : BigInt(0)).toString(),
            earned: previewFor(events, SEASON1, headTs, addr as `0x${string}`).bankedSoFar.toString(),
          }))
          .filter((r) => r.staked !== "0" || r.earned !== "0")
          .sort((a, b) => (BigInt(b.staked) > BigInt(a.staked) ? 1 : BigInt(b.staked) < BigInt(a.staked) ? -1 : 0));
        stakersMemo = { key: memoKey, stakers };
      }
    }
    return Response.json(
      {
        seasonStarted: true,
        bankedSoFar: p.bankedSoFar.toString(),
        todayAccruing: p.todayAccruing.toString(),
        ...(stakers ? { stakers } : {}),
      },
      {
        // Edge-cacheable because the URL carries the address: a shared cache
        // keys each wallet's variant separately, and the snapshot behind the
        // numbers only moves once per 30s scan window anyway. The failure path
        // below stays uncached so a blip is never pinned for other readers.
        headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
      },
    );
  } catch (err) {
    // The RESPONSE stays soft — the tiles just read "—" rather than the page
    // having to handle an error. But the failure is logged: swallowing it
    // silently meant a production outage here was indistinguishable from
    // "season not started", which is exactly how it shipped.
    console.error("[staking/rewards] snapshot failed:", err instanceof Error ? err.message : err);
    return Response.json({ seasonStarted: false }, { status: 200 });
  }
}
