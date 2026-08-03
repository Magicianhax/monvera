// NO "server-only" guard, deliberately: this module is pure math with nothing
// secret in it, and scripts/rebalance-test.ts must import it under plain tsx
// (the guard throws outside a React server bundle). Same trade as
// lib/season/compute.ts.
//
// The pure math of an auto-manage rebalance: given what a user holds, what the
// grove's published weights say they should hold, and the caps they consented
// to, decide what to sell and where the proceeds go. No chain, no venue, no
// clock — everything here is deterministic and proven by
// scripts/rebalance-test.ts, the same way lib/season/compute.ts is.
//
// Money-shaped rules, all enforced here BEFORE the contract enforces its own:
//  - act only past a real drift (a basket a few bps off stays untouched)
//  - never sell more of one holding than the user's per-rebalance fraction cap
//  - never sell beyond what the user's remaining budgets allow
//  - never plan a leg so small the swap is mostly spread
//  - sells fund buys — the plan is net-zero USDG by construction

export interface PlanHolding {
  token: `0x${string}`;
  symbol: string;
  /** Raw 18dp token amount actually held in the position. */
  amountRaw: bigint;
  /** Raw amount the manager may actually pull (standing allowance floor). */
  sellableRaw: bigint;
  priceUsd: number;
  /** Published composition weight; 0 for a token no longer in the recipe. */
  targetWeightBps: number;
}

/** A composition entry the user does not hold yet (a pure buy candidate). */
export interface PlanTarget {
  token: `0x${string}`;
  symbol: string;
  targetWeightBps: number;
}

export interface PlanCaps {
  /** min(per-action cap, remaining lifetime budget), USD. */
  maxTurnoverUsd: number;
  /** Per-holding sell limit per rebalance, bps of the held amount. */
  maxFractionBps: number;
}

export interface PlanOptions {
  /** Act only when some holding deviates at least this many bps of weight. */
  driftTriggerBps?: number;
  /** Skip the whole rebalance under this much total turnover. */
  minTurnoverUsd?: number;
  /** Drop any single leg under this (spread eats dust legs). */
  minLegUsd?: number;
  /** Contract MAX_LEGS. */
  maxLegs?: number;
}

export interface PlannedSell {
  token: `0x${string}`;
  symbol: string;
  amountRaw: bigint;
  valueUsd: number;
}

export interface PlannedBuy {
  token: `0x${string}`;
  symbol: string;
  /** Fraction of the realized sell pool this buy should spend, 0..1. */
  share: number;
}

export interface RebalancePlan {
  sells: PlannedSell[];
  buys: PlannedBuy[];
  /** Worst weight deviation seen, bps — why the plan exists. */
  maxDeviationBps: number;
  /** Planned turnover (sum of sell values), USD. */
  turnoverUsd: number;
}

const BPS = 10_000;

function toUsd(amountRaw: bigint, priceUsd: number): number {
  return (Number(amountRaw) / 1e18) * priceUsd;
}

function toRaw(valueUsd: number, priceUsd: number): bigint {
  if (priceUsd <= 0) return BigInt(0);
  // Micro-token precision then scale: floats can't carry 18dp, and Math.floor
  // keeps the plan on the never-oversell side.
  return BigInt(Math.floor((valueUsd / priceUsd) * 1e6)) * BigInt(10) ** BigInt(12);
}

/**
 * Null = leave the basket alone (not drifted enough, nothing sellable, or the
 * caps don't leave room to act). Every returned sell respects sellableRaw and
 * the fraction cap; buys are shares of whatever the sells actually realize.
 */
export function computeRebalancePlan(
  holdings: PlanHolding[],
  missingTargets: PlanTarget[],
  caps: PlanCaps,
  opts?: PlanOptions,
): RebalancePlan | null {
  const driftTriggerBps = opts?.driftTriggerBps ?? 500;
  const minTurnoverUsd = opts?.minTurnoverUsd ?? 15;
  const minLegUsd = opts?.minLegUsd ?? 5;
  const maxLegs = opts?.maxLegs ?? 20;

  // A partial valuation would misread drift entirely — refuse instead.
  if (holdings.some((h) => !(h.priceUsd > 0))) return null;
  const totalUsd = holdings.reduce((s, h) => s + toUsd(h.amountRaw, h.priceUsd), 0);
  if (totalUsd <= 0) return null;

  // Deviation per holding (actual − target) plus pure buy candidates at −target.
  const rows = holdings.map((h) => {
    const valueUsd = toUsd(h.amountRaw, h.priceUsd);
    const actualBps = (valueUsd / totalUsd) * BPS;
    return { h, valueUsd, deviationBps: actualBps - h.targetWeightBps };
  });
  const missing = missingTargets.filter((t) => !holdings.some((h) => h.token.toLowerCase() === t.token.toLowerCase()));

  const maxDeviationBps = Math.max(
    0,
    ...rows.map((r) => Math.abs(r.deviationBps)),
    ...missing.map((t) => t.targetWeightBps),
  );
  if (maxDeviationBps < driftTriggerBps) return null;

  // ── sells: overweight holdings, worst first ──
  let budgetUsd = caps.maxTurnoverUsd;
  const sells: PlannedSell[] = [];
  for (const r of rows.filter((x) => x.deviationBps > 0).sort((a, b) => b.deviationBps - a.deviationBps)) {
    if (budgetUsd < minLegUsd) break;
    const excessUsd = (r.deviationBps / BPS) * totalUsd;
    let amountRaw = toRaw(Math.min(excessUsd, budgetUsd), r.h.priceUsd);
    const fractionCapRaw = (r.h.amountRaw * BigInt(caps.maxFractionBps)) / BigInt(BPS);
    if (amountRaw > fractionCapRaw) amountRaw = fractionCapRaw;
    if (amountRaw > r.h.sellableRaw) amountRaw = r.h.sellableRaw;
    if (amountRaw <= BigInt(0)) continue;
    const valueUsd = toUsd(amountRaw, r.h.priceUsd);
    if (valueUsd < minLegUsd) continue;
    sells.push({ token: r.h.token, symbol: r.h.symbol, amountRaw, valueUsd });
    budgetUsd -= valueUsd;
  }
  const turnoverUsd = sells.reduce((s, x) => s + x.valueUsd, 0);
  if (turnoverUsd < minTurnoverUsd) return null;

  // ── buys: underweight gaps share the pool, worst first ──
  const gaps = [
    ...rows.filter((x) => x.deviationBps < 0).map((r) => ({ token: r.h.token, symbol: r.h.symbol, gapBps: -r.deviationBps, targetWeightBps: r.h.targetWeightBps })),
    ...missing.map((t) => ({ token: t.token, symbol: t.symbol, gapBps: t.targetWeightBps, targetWeightBps: t.targetWeightBps })),
  ]
    // A buy leg must land in the CURRENT composition or the contract reverts.
    .filter((x) => x.targetWeightBps > 0)
    .sort((a, b) => b.gapBps - a.gapBps);
  if (!gaps.length) return null;

  const legRoom = Math.max(1, maxLegs - sells.length);
  // Keep gaps whose share of the pool clears the leg floor, largest first.
  const gapTotal = gaps.reduce((s, x) => s + x.gapBps, 0);
  let kept = gaps.filter((x) => (x.gapBps / gapTotal) * turnoverUsd >= minLegUsd).slice(0, legRoom);
  if (!kept.length) kept = gaps.slice(0, 1); // one buy leg always fits: the pool clears minTurnoverUsd
  const keptTotal = kept.reduce((s, x) => s + x.gapBps, 0);
  const buys: PlannedBuy[] = kept.map((x) => ({ token: x.token, symbol: x.symbol, share: x.gapBps / keptTotal }));

  return { sells, buys, maxDeviationBps: Math.round(maxDeviationBps), turnoverUsd };
}
