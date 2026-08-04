// Correctness test for the tilt clamp — the safety boundary of active
// management. No chain, no model, no network: hand-checkable fixtures only.
//
//   npx tsx --conditions=react-server scripts/tilt-test.ts
//
// What this has to prove: whatever the model returns — garbage, extremes,
// missing names, NaN, a single name at 100% — the weights that reach the
// planner are inside the band and sum to exactly 10000 bps. Everything else in
// active management is judgement; this is arithmetic, so it gets tested.
import { clampWeights, TILT_MIN_MULT, TILT_MAX_MULT } from "../src/lib/server/veraTilt";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${name} ${extra}`);
  }
}

const TITAN: Record<string, number> = {
  QQQ: 1600,
  NVDA: 1400,
  MSFT: 1300,
  AAPL: 1300,
  GOOGL: 1100,
  AMZN: 1100,
  META: 1100,
  TSLA: 1100,
};
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
const inBand = (w: Record<string, number>) =>
  Object.entries(w).every(
    ([s, v]) => v >= Math.floor(TITAN[s] * TILT_MIN_MULT) - 1 && v <= Math.ceil(TITAN[s] * TILT_MAX_MULT) + 1,
  );

console.log("- identity");
{
  const w = clampWeights(TITAN, {});
  ok("no tilt keeps published weights", JSON.stringify(w) === JSON.stringify(TITAN), JSON.stringify(w));
  ok("sums to 10000", sum(w) === 10_000, String(sum(w)));
}

console.log("- a normal tilt");
{
  const w = clampWeights(TITAN, { NVDA: 1.2, TSLA: 0.8 });
  ok("sums to 10000", sum(w) === 10_000, String(sum(w)));
  ok("NVDA rose", w.NVDA > TITAN.NVDA, `${w.NVDA}`);
  ok("TSLA fell", w.TSLA < TITAN.TSLA, `${w.TSLA}`);
  ok("every weight in band", inBand(w), JSON.stringify(w));
}

console.log("- hostile model output");
{
  // The case that matters: a prompt-injected or broken model trying to put
  // everything in one name.
  const w = clampWeights(TITAN, { NVDA: 99, QQQ: 0, MSFT: 0, AAPL: 0, GOOGL: 0, AMZN: 0, META: 0, TSLA: 0 });
  ok("sums to 10000", sum(w) === 10_000, String(sum(w)));
  ok("NVDA capped at 1.3x", w.NVDA <= Math.ceil(TITAN.NVDA * TILT_MAX_MULT) + 1, `${w.NVDA}`);
  ok("no name zeroed", Object.values(w).every((v) => v > 0), JSON.stringify(w));
  ok("every weight in band", inBand(w), JSON.stringify(w));
}
{
  const w = clampWeights(TITAN, { NVDA: -5, QQQ: NaN, MSFT: Infinity, AAPL: 0 });
  ok("garbage numbers ignored", sum(w) === 10_000 && inBand(w), JSON.stringify(w));
}
{
  const w = clampWeights(TITAN, { NOTREAL: 5, NVDA: 1.1 });
  ok("unknown symbol ignored", !("NOTREAL" in w) && sum(w) === 10_000, JSON.stringify(w));
}
{
  // A name the model simply did not mention must be held, never dropped:
  // dropping it would make the planner sell the whole holding to zero.
  const w = clampWeights(TITAN, { NVDA: 1.3 });
  ok("unmentioned names survive", Object.keys(w).length === Object.keys(TITAN).length, JSON.stringify(w));
  ok("unmentioned names stay in band", inBand(w), JSON.stringify(w));
}

console.log("- extremes in both directions");
{
  const allUp = clampWeights(TITAN, Object.fromEntries(Object.keys(TITAN).map((s) => [s, 9])));
  ok("all-up still sums to 10000", sum(allUp) === 10_000, String(sum(allUp)));
  ok("all-up is the published basket (uniform scaling cancels)", JSON.stringify(allUp) === JSON.stringify(TITAN), JSON.stringify(allUp));
  const allDown = clampWeights(TITAN, Object.fromEntries(Object.keys(TITAN).map((s) => [s, 0.01])));
  ok("all-down still sums to 10000", sum(allDown) === 10_000, String(sum(allDown)));
}

console.log("- a two-name grove (rounding has nowhere to hide)");
{
  const pair = { AAA: 5000, BBB: 5000 };
  const w = clampWeights(pair, { AAA: 1.3, BBB: 0.7 });
  ok("sums to 10000", sum(w) === 10_000, JSON.stringify(w));
  ok("in band", w.AAA <= 6500 + 1 && w.BBB >= 3500 - 1, JSON.stringify(w));
}
{
  // Weights that do not divide evenly: the remainder must land somewhere.
  const odd = { AAA: 3333, BBB: 3333, CCC: 3334 };
  const w = clampWeights(odd, { AAA: 1.11, BBB: 0.93 });
  ok("odd weights sum to 10000", sum(w) === 10_000, JSON.stringify(w));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
