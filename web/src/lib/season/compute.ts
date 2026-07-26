// Season reward computation — the whole off-chain model, as pure functions.
//
// MonveraStaking has no reward math on-chain by design; this is where the model
// lives. It is deliberately pure (no I/O beyond viem's keccak256/encodePacked,
// which are pure) so the same code runs in the CLI that builds the final merkle
// root AND in the Cloudflare Worker that serves the live "banked so far" preview.
// One implementation, so the preview and the payout can never diverge.
//
// The model (owner-locked, 2026-07-24):
//   - 2,000,000 $MONVERA over 90 days, a FLAT daily bucket of pool/90.
//   - Each day's bucket is split purely by that day's stake-time (token-seconds):
//     reward_day = dayPool * yourTokenSeconds / everyonesTokenSeconds. No
//     multipliers, same rule for everyone.
//   - Finished days are BANKED and only add up: a late staker cannot dilute a
//     day that already closed, so bankedSoFar is monotone non-decreasing.
//   - NO per-wallet cap. Everyone earns strictly in proportion to stake x time.
//     Integer flooring on every division alone guarantees sum(leaves) <= pool;
//     the floor remainder (dust) is SWEPT back to the treasury, never
//     redistributed. The only anti-abuse lever is the `exclude` sybil set.
//   - An empty day (nobody staked) rolls its bucket forward to the next day.
//
// All amounts are raw 18dp wei. Every division floors. There is no floating
// point in the reward path.
import { keccak256, encodePacked } from "viem";

export const SECONDS_PER_DAY = BigInt(86_400);

/** A staking event, already decoded and sorted by (blockNumber, logIndex). */
export interface StakeEvent {
  kind: "Staked" | "UnstakeRequested" | "UnstakeCancelled" | "Withdrawn";
  user: `0x${string}`;
  amount: bigint;
  /** stakedAfter for Staked/UnstakeCancelled; undefined otherwise. */
  stakedAfter?: bigint;
  ts: bigint; // block timestamp, unix seconds
}

export interface SeasonParams {
  seasonId: bigint;
  /** UTC unix seconds of day-0 00:00. Every reward number depends on this. */
  seasonStart: bigint;
  days: number; // 90
  pool: bigint; // 2_000_000e18
  /** Addresses excluded from rewards (sybil cluster). Lowercased. This is the
   *  only anti-abuse lever now that there is no per-wallet cap: honest stakers
   *  earn strictly in proportion to stake x time, a known bad cluster is dropped. */
  exclude?: Set<string>;
}

/** One wallet's balance over time, as [timestamp, balanceAfter] checkpoints. */
export type Timeline = { t: bigint; bal: bigint }[];

/**
 * Replay staked balances from the event stream. The one landmine: Withdrawn is
 * a NO-OP for staked balance — it settles the pending (already-unstaked) amount,
 * so subtracting here would double-count. requestUnstake already moved the amount
 * out of `staked`; cooling balances earn nothing, exactly as intended.
 */
export function replayBalances(events: StakeEvent[]): Map<string, Timeline> {
  const bal = new Map<string, bigint>();
  const timelines = new Map<string, Timeline>();
  for (const e of events) {
    const key = e.user.toLowerCase();
    let b = bal.get(key) ?? BigInt(0);
    switch (e.kind) {
      case "Staked":
        b += e.amount;
        if (e.stakedAfter !== undefined && b !== e.stakedAfter) {
          throw new Error(`Staked replay mismatch for ${key} at ${e.ts}: got ${b}, chain said ${e.stakedAfter}`);
        }
        break;
      case "UnstakeRequested":
        if (b < e.amount) throw new Error(`UnstakeRequested underflow for ${key} at ${e.ts}: bal ${b} < ${e.amount}`);
        b -= e.amount;
        break;
      case "UnstakeCancelled":
        b += e.amount;
        if (e.stakedAfter !== undefined && b !== e.stakedAfter) {
          throw new Error(`UnstakeCancelled replay mismatch for ${key} at ${e.ts}: got ${b}, chain said ${e.stakedAfter}`);
        }
        break;
      case "Withdrawn":
        continue; // NO-OP for staked balance.
    }
    bal.set(key, b);
    const tl = timelines.get(key) ?? [];
    // Collapse same-timestamp edits to the final value of that instant.
    if (tl.length > 0 && tl[tl.length - 1].t === e.ts) tl[tl.length - 1].bal = b;
    else tl.push({ t: e.ts, bal: b });
    timelines.set(key, tl);
  }
  return timelines;
}

/** Per-day pool: floor(pool/days) each, with the floor remainder on the last day
 *  so the 90 buckets sum to EXACTLY `pool` (matters against an immutable root). */
export function dailyPools(pool: bigint, days: number): bigint[] {
  const base = pool / BigInt(days);
  const out = new Array<bigint>(days).fill(base);
  out[days - 1] += pool - base * BigInt(days);
  return out;
}

/** Integrate a wallet's token-seconds into each UTC day bucket over
 *  [seasonStart, upTo). upTo is min(now, seasonEnd). */
function integrateOne(tl: Timeline, seasonStart: bigint, days: number, upTo: bigint): bigint[] {
  const out = new Array<bigint>(days).fill(BigInt(0));
  if (tl.length === 0) return out;
  const seasonEnd = seasonStart + BigInt(days) * SECONDS_PER_DAY;
  const end = upTo < seasonEnd ? upTo : seasonEnd;
  for (let i = 0; i < tl.length; i++) {
    const bal = tl[i].bal;
    if (bal === BigInt(0)) continue;
    // This balance holds from this checkpoint until the next one (or `end`).
    let from = tl[i].t;
    let to = i + 1 < tl.length ? tl[i + 1].t : end;
    if (from < seasonStart) from = seasonStart;
    if (to > end) to = end;
    if (to <= from) continue;
    // Split [from, to) at each day boundary and credit bal*seconds per day.
    let cursor = from;
    while (cursor < to) {
      const day = Number((cursor - seasonStart) / SECONDS_PER_DAY);
      if (day < 0 || day >= days) break;
      const dayEnd = seasonStart + BigInt(day + 1) * SECONDS_PER_DAY;
      const segEnd = to < dayEnd ? to : dayEnd;
      out[day] += bal * (segEnd - cursor);
      cursor = segEnd;
    }
  }
  return out;
}

/** token-seconds per wallet per day, plus the per-day totals. */
export function integrate(timelines: Map<string, Timeline>, p: SeasonParams, upTo: bigint) {
  const perWallet = new Map<string, bigint[]>();
  const totals = new Array<bigint>(p.days).fill(BigInt(0));
  for (const [key, tl] of timelines) {
    if (p.exclude?.has(key)) continue;
    const w = integrateOne(tl, p.seasonStart, p.days, upTo);
    perWallet.set(key, w);
    for (let d = 0; d < p.days; d++) totals[d] += w[d];
  }
  return { perWallet, totals };
}

/** All-time token-seconds for one wallet up to `upTo`, matching the on-chain
 *  weightOf accumulator: Σ balance × seconds from the wallet's first stake,
 *  NOT clamped to the season window (unlike integrate). The reconciliation gate
 *  compares this against weightOf()/totalWeight() so a silently-dropped event —
 *  even one for a wallet that has since fully exited (staked balance 0) — trips
 *  the totalWeight sum check that a stakedOf-only gate is blind to. */
export function weightUpTo(tl: Timeline, upTo: bigint): bigint {
  let w = BigInt(0);
  for (let i = 0; i < tl.length; i++) {
    const from = tl[i].t;
    if (from >= upTo) break;
    const next = i + 1 < tl.length ? tl[i + 1].t : upTo;
    const to = next < upTo ? next : upTo;
    if (to > from) w += tl[i].bal * (to - from);
  }
  return w;
}

/** How many season days are fully finished as of `upTo`. */
export function finishedDays(p: SeasonParams, upTo: bigint): number {
  if (upTo <= p.seasonStart) return 0;
  const elapsed = Number((upTo - p.seasonStart) / SECONDS_PER_DAY);
  return Math.max(0, Math.min(p.days, elapsed));
}

/**
 * Split each day's pool by that day's token-seconds, over days [0, upToDay).
 * Empty days (zero total) roll their bucket forward into the next day via carry.
 * Returns raw (uncapped) reward per wallet in wei.
 */
export function distribute(
  perWallet: Map<string, bigint[]>,
  totals: bigint[],
  pools: bigint[],
  upToDay: number,
): Map<string, bigint> {
  const reward = new Map<string, bigint>();
  let carry = BigInt(0);
  for (let d = 0; d < upToDay; d++) {
    const dayPool = pools[d] + carry;
    if (totals[d] === BigInt(0)) {
      carry = dayPool; // nobody staked: roll the whole bucket forward.
      continue;
    }
    carry = BigInt(0);
    for (const [key, w] of perWallet) {
      if (w[d] === BigInt(0)) continue;
      const share = (dayPool * w[d]) / totals[d]; // floored
      if (share > BigInt(0)) reward.set(key, (reward.get(key) ?? BigInt(0)) + share);
    }
  }
  return reward;
}

// ── merkle (must match SeasonDistributor + OZ MerkleProof exactly) ────────────
// Leaf: keccak256(abi.encodePacked(uint256 seasonId, address account, uint256 amount)) — SINGLE hash.
// Internal nodes: sorted-pair keccak256(abi.encodePacked(bytes32,bytes32)), children ascending.
// NEVER use @openzeppelin/merkle-tree (StandardMerkleTree) — it double-hashes leaves
// and the on-chain MerkleProof.verify would reject the root.

export function leafOf(seasonId: bigint, account: `0x${string}`, amount: bigint): `0x${string}` {
  return keccak256(encodePacked(["uint256", "address", "uint256"], [seasonId, account, amount]));
}

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(encodePacked(["bytes32", "bytes32"], [lo, hi]));
}

/** Build the layers of the tree from leaf hashes. Lone node at a layer is
 *  promoted unchanged. Returns layers[0] = leaves, last layer = [root]. */
export function buildLayers(leaves: `0x${string}`[]): `0x${string}`[][] {
  if (leaves.length === 0) return [["0x" + "0".repeat(64) as `0x${string}`]];
  const layers: `0x${string}`[][] = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: `0x${string}`[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return layers;
}

export function rootOf(layers: `0x${string}`[][]): `0x${string}` {
  return layers[layers.length - 1][0];
}

/** Proof for the leaf at index `idx`, mirroring buildLayers' lone-node promotion. */
export function proofFor(layers: `0x${string}`[][], idx: number): `0x${string}`[] {
  const proof: `0x${string}`[] = [];
  let i = idx;
  for (let layer = 0; layer < layers.length - 1; layer++) {
    const nodes = layers[layer];
    const sibling = i ^ 1;
    if (sibling < nodes.length) proof.push(nodes[sibling]); // else lone node, no sibling
    i = Math.floor(i / 2);
  }
  return proof;
}

/** Local equivalent of OZ MerkleProof.verify — fold the proof with sorted-pair
 *  hashing and compare to the root. Lets the CLI prove every leaf claims before
 *  the root is ever opened on-chain. */
export function verifyProof(leaf: `0x${string}`, proof: `0x${string}`[], root: `0x${string}`): boolean {
  let computed = leaf;
  for (const sib of proof) computed = hashPair(computed, sib);
  return computed.toLowerCase() === root.toLowerCase();
}

export interface SeasonResult {
  /** Final leaves: address -> amount (wei). Zero amounts dropped. */
  leaves: { account: `0x${string}`; amount: bigint }[];
  root: `0x${string}`;
  swept: bigint; // floor dust + any rolled-forward-past-end pool, returns to treasury
  totalDistributed: bigint;
  proofs: Record<string, `0x${string}`[]>;
}

/** Build the final merkle-ized season result over ALL 90 days. Pure proportional,
 *  no cap: each wallet's amount is its stake-time share of every day. Integer
 *  flooring alone guarantees sum(leaves) <= pool. Call with the pinned
 *  season-end timestamp. */
export function buildSeason(events: StakeEvent[], p: SeasonParams): SeasonResult {
  const seasonEnd = p.seasonStart + BigInt(p.days) * SECONDS_PER_DAY;
  const timelines = replayBalances(events);
  const { perWallet, totals } = integrate(timelines, p, seasonEnd);
  const raw = distribute(perWallet, totals, dailyPools(p.pool, p.days), p.days);

  // Deterministic order: by address ascending, so the root is reproducible.
  const entries = [...raw.entries()]
    .filter(([, amount]) => amount > BigInt(0))
    .map(([a, amount]) => ({ account: a as `0x${string}`, amount }))
    .sort((x, y) => (x.account.toLowerCase() < y.account.toLowerCase() ? -1 : 1));

  let totalDistributed = BigInt(0);
  for (const e of entries) totalDistributed += e.amount;
  if (totalDistributed > p.pool) throw new Error(`sum(leaves) ${totalDistributed} > pool ${p.pool}`);
  const swept = p.pool - totalDistributed;

  const leafHashes = entries.map((e) => leafOf(p.seasonId, e.account, e.amount));
  const layers = buildLayers(leafHashes);
  const proofs: Record<string, `0x${string}`[]> = {};
  entries.forEach((e, i) => { proofs[e.account.toLowerCase()] = proofFor(layers, i); });

  return { leaves: entries, root: rootOf(layers), swept, totalDistributed, proofs };
}

export interface RewardPreview {
  bankedSoFar: bigint; // finished days, monotone non-decreasing
  todayAccruing: bigint; // provisional current-day share, moves with today's stakers
}

/** Live preview for the UI: banked (finished days) + today's provisional accrual.
 *  `now` is the snapshot time. This is exactly the StakerRewards shape. */
export function previewFor(events: StakeEvent[], p: SeasonParams, now: bigint, wallet: `0x${string}`): RewardPreview {
  const key = wallet.toLowerCase();
  if (p.exclude?.has(key)) return { bankedSoFar: BigInt(0), todayAccruing: BigInt(0) };
  const timelines = replayBalances(events);
  const pools = dailyPools(p.pool, p.days);
  const done = finishedDays(p, now);

  // Banked: finished days only (their totals are historical and fixed).
  const finished = integrate(timelines, p, p.seasonStart + BigInt(done) * SECONDS_PER_DAY);
  const banked = distribute(finished.perWallet, finished.totals, pools, done);
  const bankedSoFar = banked.get(key) ?? BigInt(0);

  // Today: the partial current day [done], integrated up to `now`.
  let todayAccruing = BigInt(0);
  if (done < p.days) {
    const upto = integrate(timelines, p, now);
    const myToday = upto.perWallet.get(key)?.[done] ?? BigInt(0);
    const totToday = upto.totals[done];
    if (totToday > BigInt(0) && myToday > BigInt(0)) {
      todayAccruing = (pools[done] * myToday) / totToday;
    }
  }
  return { bankedSoFar, todayAccruing };
}
