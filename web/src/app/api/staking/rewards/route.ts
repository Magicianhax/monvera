import "server-only";

// GET /api/staking/rewards?address=0x… — live season reward preview for one
// wallet: { seasonStarted, bankedSoFar, todayAccruing } (raw 18dp wei strings).
//
// ⚠️ The staking page no longer calls this (2026-10-09): from Cloudflare's
// egress the public RPC 429s every getLogs/eth_call and Blockscout challenges,
// so the scan cannot complete here. The page scans in the browser instead
// (lib/season/liveBoard.ts, same model via lib/season/board.ts). This route
// works again only once STAKING_LOGS_RPC_URL points at an endpoint that serves
// eth_getLogs to Workers.
//
// Runs the SAME off-chain model as the final merkle payout (compute.ts) over the
// staking event stream up to the chain head, so the "Earned so far" / "This
// epoch, accruing" tiles show a number that grows from epoch 1 and, at close,
// equals what the claim manifest pays. The event scan is shared across the whole
// deployment via kvCached (stale-while-revalidate), so only the first reader per
// TTL ever pays for it.
import { isAddress } from "viem";
import { kvCached } from "@/lib/server/kvCache";
import { stakingAbi, stakingChain, stakingLogsClient } from "@/lib/staking";
import { fetchStakeEvents } from "@/lib/season/fetch";
import { previewFor, type StakeEvent } from "@/lib/season/compute";
import { buildBoard, reconciles } from "@/lib/season/board";
import { SEASON1, DEPLOY_BLOCK, STAKING } from "@/lib/season/config";

export const dynamic = "force-dynamic";

interface EventSnapshot {
  events: StakeEvent[];
  headTs: bigint;
  /** Last block the events are complete through. Absent on pre-cursor entries. */
  toBlock?: bigint;
  /** Reached the head AND reconciled with totalStaked — the only state served.
   *  A not-ready snapshot is cold-scan progress parked in KV for the next refresh. */
  ready?: boolean;
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

// One shared scan per 30s for the whole fleet, INCREMENTAL and RESUMABLE.
//
// The history is ~66M blocks and grows ~1M/day, and the only log source the
// Worker can reach — the public RPC — answers Cloudflare's shared egress with
// 429 "Too Many Requests" on a good share of calls (wrangler tail, 2026-10-09).
// A cold scan is 7+ windows, so demanding all of them succeed in one request
// meant it never finished. Instead each refresh advances a contiguous cursor as
// far as it gets and parks that progress in KV (ready:false, never served); the
// next refresh resumes. Once at the head and reconciled, refreshes only scan
// the few hundred blocks since the last one.
async function loadEvents(prev?: EventSnapshot): Promise<EventSnapshot> {
  const head = await stakingLogsClient.getBlockNumber();
  const headTs = (await stakingLogsClient.getBlock({ blockNumber: head })).timestamp;

  const resume = prev?.toBlock !== undefined && prev.toBlock <= head;
  const events = resume ? [...prev!.events] : [];
  let cursor = resume ? prev!.toBlock! : DEPLOY_BLOCK - BigInt(1);
  while (cursor < head) {
    const to = cursor + LOG_SPAN < head ? cursor + LOG_SPAN : head;
    try {
      events.push(...(await scan(cursor + BigInt(1), to)));
      cursor = to;
    } catch (err) {
      console.warn(`[staking/rewards] scan stopped at ${cursor} of ${head}:`, err instanceof Error ? err.message.split("\n")[0] : err);
      break;
    }
  }

  // A served snapshot stays served through a blip: throwing keeps kvCached on
  // the stale ready value. Cold progress is returned (not ready) so it sticks.
  const parked = (): EventSnapshot => ({ events, headTs, toBlock: cursor, ready: false });
  if (cursor < head) {
    if (prev?.ready) throw new Error(`incremental scan short of head (${cursor} < ${head})`);
    return parked();
  }

  // Same endpoint as `head`, so the block is known to exist there (the keyed
  // read endpoint can trail the public one at ~12 blocks/s).
  let totalStaked: bigint;
  try {
    totalStaked = await stakingLogsClient.readContract({ address: STAKING, abi: stakingAbi, functionName: "totalStaked", blockNumber: head });
  } catch (err) {
    if (prev?.ready) throw err;
    return parked();
  }

  // Sanity gate, same discipline as the season builder: a short getLogs is
  // indistinguishable from "nobody staked", and caching it would serve every
  // staker a confident, WRONG number. Refuse it and start over from the deploy
  // block — the UI shows "—" until the rescan lands, which is honest.
  if (!reconciles(events, totalStaked)) {
    console.warn(`[staking/rewards] scan does not reconcile with totalStaked=${totalStaked} — rescanning from deploy`);
    return { events: [], headTs, toBlock: DEPLOY_BLOCK - BigInt(1), ready: false };
  }
  return { events, headTs, toBlock: head, ready: true };
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
    const { events, headTs, ready } = await kvCached<EventSnapshot>(
      `staking-rewards-events:${stakingChain.id}:${DEPLOY_BLOCK}`,
      30_000,
      loadEvents,
    );
    // Cold scan still in progress (resumes on the next refresh): unavailable,
    // uncached, same "—" the tiles show for any other gap.
    if (!ready) return Response.json({ seasonStarted: false });
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
        stakers = buildBoard(events, SEASON1, headTs).map((r) => ({
          address: r.address,
          staked: r.staked.toString(),
          earned: (r.earned ?? BigInt(0)).toString(),
        }));
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
