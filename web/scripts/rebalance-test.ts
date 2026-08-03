// Deterministic, chain-free proof of the auto-manage rebalance math
// (lib/server/rebalancePlan.ts) — the same idiom as season-test.ts:
//
//   npx tsx scripts/rebalance-test.ts
//
// Every case is hand-checkable arithmetic. If one of these fails, the driver
// must not run.
import {
  computeRebalancePlan,
  type PlanHolding,
  type PlanTarget,
  type PlanCaps,
} from "../src/lib/server/rebalancePlan";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const C = "0xcccccccccccccccccccccccccccccccccccccccc" as const;

const RAW = (tokens: number) => BigInt(Math.round(tokens * 1e6)) * BigInt(10) ** BigInt(12);

/** A holding priced at $1/token so value == token count — hand-checkable. */
function h(token: `0x${string}`, symbol: string, tokens: number, targetWeightBps: number, over?: Partial<PlanHolding>): PlanHolding {
  return { token, symbol, amountRaw: RAW(tokens), sellableRaw: RAW(tokens), priceUsd: 1, targetWeightBps, ...over };
}

const CAPS: PlanCaps = { maxTurnoverUsd: 250, maxFractionBps: 2_000 };

// ── 1 · a balanced basket stays untouched ──
check("balanced basket -> null", computeRebalancePlan([h(A, "AAA", 500, 5000), h(B, "BBB", 500, 5000)], [], CAPS) === null);

// ── 2 · drift under the trigger stays untouched ──
// 54/46 vs 50/50 = 400bps deviation < 500bps trigger.
check("sub-trigger drift -> null", computeRebalancePlan([h(A, "AAA", 540, 5000), h(B, "BBB", 460, 5000)], [], CAPS) === null);

// ── 3 · a real drift sells the overweight, fraction-capped ──
// 70/30 vs 50/50 on $1000: excess $200, but 20% of the $700 holding = $140.
{
  const plan = computeRebalancePlan([h(A, "AAA", 700, 5000), h(B, "BBB", 300, 5000)], [], CAPS);
  check("drift plans a sell", !!plan && plan.sells.length === 1 && plan.sells[0].symbol === "AAA");
  check("fraction cap binds", !!plan && Math.abs(plan.sells[0].valueUsd - 140) < 0.01, `got ${plan?.sells[0].valueUsd}`);
  check("one buy, full share", !!plan && plan.buys.length === 1 && plan.buys[0].symbol === "BBB" && plan.buys[0].share === 1);
  check("deviation reported", !!plan && plan.maxDeviationBps === 2000, `got ${plan?.maxDeviationBps}`);
}

// ── 4 · the turnover budget binds before the fraction cap ──
{
  const plan = computeRebalancePlan([h(A, "AAA", 700, 5000), h(B, "BBB", 300, 5000)], [], { maxTurnoverUsd: 50, maxFractionBps: 2_000 });
  check("budget caps the sell", !!plan && Math.abs(plan.sells[0].valueUsd - 50) < 0.01, `got ${plan?.sells[0].valueUsd}`);
}

// ── 5 · no standing allowance -> nothing sellable -> no plan ──
check(
  "zero allowance -> null",
  computeRebalancePlan([h(A, "AAA", 700, 5000, { sellableRaw: BigInt(0) }), h(B, "BBB", 300, 5000)], [], CAPS) === null,
);

// ── 6 · dollar-tiny positions never churn ──
// Same 70/30 drift on a $10 basket: turnover $1.40 < $15 floor.
check("tiny basket -> null", computeRebalancePlan([h(A, "AAA", 7, 5000), h(B, "BBB", 3, 5000)], [], CAPS) === null);

// ── 7 · a token dropped from the recipe sells but is never bought ──
// C holds 30% at target 0; A underweight takes the proceeds.
{
  const plan = computeRebalancePlan(
    [h(A, "AAA", 400, 6000), h(B, "BBB", 300, 4000), h(C, "CCC", 300, 0)],
    [],
    CAPS,
  );
  check("delisted token sells", !!plan && plan.sells.some((s) => s.symbol === "CCC"));
  check("delisted token never bought", !!plan && !plan.buys.some((b) => b.symbol === "CCC"));
}

// ── 8 · a composition token the user does not hold yet gets bought ──
// A 100% held vs 50/50 target with B missing entirely.
{
  const missing: PlanTarget[] = [{ token: B, symbol: "BBB", targetWeightBps: 5000 }];
  const plan = computeRebalancePlan([h(A, "AAA", 1000, 5000)], missing, CAPS);
  check("missing target becomes the buy", !!plan && plan.buys.length === 1 && plan.buys[0].symbol === "BBB");
  check("missing-target sell respects fraction cap", !!plan && Math.abs(plan.sells[0].valueUsd - 200) < 0.01, `got ${plan?.sells[0].valueUsd}`);
}

// ── 9 · an unpriced holding refuses the whole plan ──
check(
  "unpriced holding -> null",
  computeRebalancePlan([h(A, "AAA", 700, 5000, { priceUsd: 0 }), h(B, "BBB", 300, 5000)], [], CAPS) === null,
);

// ── 10 · buy shares always sum to 1 ──
{
  const plan = computeRebalancePlan(
    [h(A, "AAA", 700, 4000), h(B, "BBB", 200, 3000), h(C, "CCC", 100, 3000)],
    [],
    CAPS,
  );
  const sum = plan?.buys.reduce((s, b) => s + b.share, 0) ?? 0;
  check("buy shares sum to 1", !!plan && Math.abs(sum - 1) < 1e-9, `got ${sum}`);
}

// ── 11 · sells never exceed what is actually sellable ──
{
  const sellable = RAW(50);
  const plan = computeRebalancePlan(
    [h(A, "AAA", 700, 5000, { sellableRaw: sellable }), h(B, "BBB", 300, 5000)],
    [],
    CAPS,
  );
  check("allowance floor binds the sell", !!plan && plan.sells[0].amountRaw <= sellable, `raw ${plan?.sells[0].amountRaw}`);
}

// ── 12 · determinism: same inputs, same plan ──
{
  const input: PlanHolding[] = [h(A, "AAA", 700, 5000), h(B, "BBB", 300, 5000)];
  const p1 = computeRebalancePlan(input, [], CAPS);
  const p2 = computeRebalancePlan(input, [], CAPS);
  check("deterministic", JSON.stringify(p1, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) === JSON.stringify(p2, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

console.log(`\nrebalance-test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
