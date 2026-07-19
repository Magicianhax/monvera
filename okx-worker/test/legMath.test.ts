import {
  capAllocationLegs,
  splitByWeights,
  maxLegsForAmount,
  RFQ_MIN_BUY_USD,
  OKX_MIN_LEG_USD,
} from "../src/legMath";

test("caps legs so every survivor clears the floor and weights sum to 100", () => {
  const input = [
    { symbol: "AAPLx", weightPct: 90 },
    { symbol: "TSLAx", weightPct: 5 },
    { symbol: "NVDAx", weightPct: 5 },
  ];
  const out = capAllocationLegs(input, 100);
  const total = out.reduce((s, a) => s + a.weightPct, 0);
  expect(total).toBe(100);
  for (const leg of out) {
    expect((leg.weightPct / 100) * 100).toBeGreaterThanOrEqual(RFQ_MIN_BUY_USD);
  }
});

test("capAllocationLegs honors a custom $15 OKX floor", () => {
  const input = [
    { symbol: "AAPLx", weightPct: 50 },
    { symbol: "MSFTx", weightPct: 30 },
    { symbol: "NVDAx", weightPct: 12 },
    { symbol: "SPYx", weightPct: 8 },
  ];
  const out = capAllocationLegs(input, 60, OKX_MIN_LEG_USD);
  const total = out.reduce((s, a) => s + a.weightPct, 0);
  expect(total).toBe(100);
  for (const leg of out) {
    expect((leg.weightPct / 100) * 60).toBeGreaterThanOrEqual(OKX_MIN_LEG_USD);
  }
  expect(out.length).toBeLessThanOrEqual(Math.floor(60 / OKX_MIN_LEG_USD));
});

test("splitByWeights conserves the total exactly (largest remainder)", () => {
  const parts = splitByWeights(1_000_001n, [33, 33, 34]);
  expect(parts).toHaveLength(3);
  expect(parts.reduce((s, p) => s + p, 0n)).toBe(1_000_001n);
});

test("splitByWeights gives zero to zero-weight legs", () => {
  const parts = splitByWeights(100n, [0, 100]);
  expect(parts[0]).toBe(0n);
  expect(parts[1]).toBe(100n);
});

test("maxLegsForAmount floors at the default $11 per leg", () => {
  expect(maxLegsForAmount(100)).toBe(9);
  expect(maxLegsForAmount(11)).toBe(1);
  expect(maxLegsForAmount(5)).toBe(1);
});

test("maxLegsForAmount honors a custom floor", () => {
  expect(maxLegsForAmount(100, OKX_MIN_LEG_USD)).toBe(6);
  expect(maxLegsForAmount(15, OKX_MIN_LEG_USD)).toBe(1);
});
