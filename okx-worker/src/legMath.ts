// Leg math ported from web/src/lib/arcusShared.ts (incident-tested rules).
// Dependency-free. The floor is parameterized: Arcus RFQ measured $11; the OKX
// aggregator enforces a $15 minimum per swap order (owner-verified on X Layer),
// so okx-dex legs size against OKX_MIN_LEG_USD.

/**
 * Split a total (in base units) across weighted legs so the parts sum EXACTLY
 * to the total (largest-remainder method). Zero-weight legs get zero.
 */
export function splitByWeights(total: bigint, weightsPct: number[]): bigint[] {
  const weightSum = weightsPct.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return weightsPct.map(() => BigInt(0));
  const exact = weightsPct.map(
    (w) => (total * BigInt(Math.round(w * 100))) / BigInt(Math.round(weightSum * 100))
  );
  let remainder = total - exact.reduce((s, v) => s + v, BigInt(0));
  // Hand the leftover base units to the largest legs first (stable, deterministic).
  const order = exact
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v === b.v ? a.i - b.i : b.v > a.v ? 1 : -1));
  const out = [...exact];
  for (const { i } of order) {
    if (remainder <= BigInt(0)) break;
    out[i] += BigInt(1);
    remainder -= BigInt(1);
  }
  return out;
}

/**
 * The order sizes RFQ makers are known to fill, in whole dollars. Measured
 * against the live Arcus router: a $10 buy was rejected, $11 filled.
 */
export const RFQ_MIN_BUY_USD = 11;

/** OKX DEX aggregator minimum per swap order on X LAYER (owner-verified).
 *  Applies only if/when legs execute on X Layer — NOT on Solana. */
export const OKX_MIN_LEG_USD = 15;

/** Solana swaps have no venue minimum (owner-verified) — this is purely a
 *  dust guard so a small budget doesn't shatter into worthless slivers. */
export const SOL_MIN_LEG_USD = 1;

/** Minimum a plan must invest — one leg that clears the floor. */
export const MIN_INVEST_USD = RFQ_MIN_BUY_USD;

/** Most legs an amount can support with every leg at or above the floor. */
export function maxLegsForAmount(amountUsd: number, minLegUsd: number = RFQ_MIN_BUY_USD): number {
  return Math.max(1, Math.floor(amountUsd / minLegUsd));
}

/**
 * Cap a plan's holdings so every leg clears the floor when the amount is split
 * by weight. Splitting $40 across 8 names makes ~$5 legs that venues reject;
 * only some fill and the user's money lands short.
 *
 * Keeps the highest-weight names up to floor(amount / floor$), then drops the
 * smallest remaining leg until each survivor's dollar share is >= floor$, and
 * renormalizes to whole percents summing to 100.
 */
export function capAllocationLegs<T extends { weightPct: number }>(
  allocations: T[],
  amountUsd: number,
  minLegUsd: number = RFQ_MIN_BUY_USD
): T[] {
  let list = [...allocations]
    .filter((a) => a.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, maxLegsForAmount(amountUsd, minLegUsd));

  // Drop the smallest leg until every survivor's share clears the floor.
  while (list.length > 1) {
    const total = list.reduce((s, a) => s + a.weightPct, 0);
    const min = list[list.length - 1];
    if ((min.weightPct / total) * amountUsd >= minLegUsd) break;
    list = list.slice(0, -1);
  }

  // Renormalize to integer percents summing to exactly 100 (largest remainder).
  const total = list.reduce((s, a) => s + a.weightPct, 0) || 1;
  const scaled = list.map((a) => ({ a, exact: (a.weightPct / total) * 100 }));
  const floored = scaled.map((x) => ({ ...x, floor: Math.floor(x.exact) }));
  let left = 100 - floored.reduce((s, x) => s + x.floor, 0);
  const byRem = [...floored].sort((x, y) => y.exact - y.floor - (x.exact - x.floor));
  const bump = new Set<T>();
  for (const x of byRem) {
    if (left <= 0) break;
    bump.add(x.a);
    left--;
  }
  return floored.map((x) => ({ ...x.a, weightPct: x.floor + (bump.has(x.a) ? 1 : 0) }));
}
