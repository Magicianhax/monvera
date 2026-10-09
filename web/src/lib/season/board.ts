// Leaderboard + reconciliation over the staking event stream. Pure, so the
// browser scan (liveBoard.ts) and the server route run the identical model —
// and both the same one as the merkle payout (compute.ts).
import { previewFor, replayBalances, type SeasonParams, type StakeEvent } from "./compute";

export interface BoardRow {
  address: `0x${string}`;
  staked: bigint;
  /** Season rewards banked so far; undefined while no season is configured. */
  earned?: bigint;
}

/** Σ replayed staked balance == the contract's totalStaked (stake credits the
 *  measured delta it emits; requestUnstake/cancel move it 1:1). replayBalances
 *  also throws on any per-wallet stakedAfter mismatch, i.e. a dropped event. */
export function reconciles(events: StakeEvent[], totalStaked: bigint): boolean {
  try {
    let sum = BigInt(0);
    for (const tl of replayBalances(events).values()) sum += tl.length ? tl[tl.length - 1].bal : BigInt(0);
    return sum === totalStaked;
  } catch {
    return false;
  }
}

/** Every staker with a balance or an earned figure, biggest stake first. */
export function buildBoard(events: StakeEvent[], season: SeasonParams, headTs: bigint): BoardRow[] {
  const seasonOn = season.seasonStart !== BigInt(0);
  return [...replayBalances(events).entries()]
    .map(([addr, tl]) => ({
      address: addr as `0x${string}`,
      staked: tl.length ? tl[tl.length - 1].bal : BigInt(0),
      earned: seasonOn ? previewFor(events, season, headTs, addr as `0x${string}`).bankedSoFar : undefined,
    }))
    .filter((r) => r.staked > BigInt(0) || (r.earned ?? BigInt(0)) > BigInt(0))
    .sort((a, b) => (b.staked > a.staked ? 1 : b.staked < a.staked ? -1 : 0));
}
