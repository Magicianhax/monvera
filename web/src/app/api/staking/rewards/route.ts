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
}

// One shared scan per 30s for the whole fleet. The staking chain is permissive
// on log range, so scan wide (1M blocks/call); fetch.ts shrinks if an RPC balks.
async function loadEvents(): Promise<EventSnapshot> {
  const head = await stakingLogsClient.getBlockNumber();
  const headTs = (await stakingLogsClient.getBlock({ blockNumber: head })).timestamp;
  const events = await fetchStakeEvents(stakingLogsClient, STAKING, DEPLOY_BLOCK, head, BigInt(1_000_000));

  // Sanity gate, same discipline as the season builder: a transient empty
  // getLogs is indistinguishable from "nobody staked", and caching it would
  // serve every staker a confident, WRONG zero for 30s. Cross-check the scan
  // against the chain's own totalStaked and refuse the snapshot if they
  // disagree — the caller then reports unavailable and the UI shows "—",
  // which is honest, instead of a zero that reads as "you earned nothing".
  const totalStaked = await stakingClient.readContract({
    address: STAKING,
    abi: stakingAbi,
    functionName: "totalStaked",
    blockNumber: head,
  });
  if (totalStaked > BigInt(0) && events.length === 0) {
    throw new Error(`reward scan empty while totalStaked=${totalStaked} — refusing snapshot`);
  }
  return { events, headTs };
}

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
      const timelines = replayBalances(events);
      stakers = [...timelines.entries()]
        .map(([addr, tl]) => ({
          address: addr,
          staked: (tl.length ? tl[tl.length - 1].bal : BigInt(0)).toString(),
          earned: previewFor(events, SEASON1, headTs, addr as `0x${string}`).bankedSoFar.toString(),
        }))
        .filter((r) => r.staked !== "0" || r.earned !== "0")
        .sort((a, b) => (BigInt(b.staked) > BigInt(a.staked) ? 1 : BigInt(b.staked) < BigInt(a.staked) ? -1 : 0));
    }
    return Response.json({
      seasonStarted: true,
      bankedSoFar: p.bankedSoFar.toString(),
      todayAccruing: p.todayAccruing.toString(),
      ...(stakers ? { stakers } : {}),
    });
  } catch {
    // Never surface as an error the page must handle — the tiles just stay "—".
    return Response.json({ seasonStarted: false }, { status: 200 });
  }
}
