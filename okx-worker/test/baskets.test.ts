import { BASKETS, resolveBasket, screenSymbols, HALAL_SCREEN } from "../src/baskets";
import { assetBySymbol } from "../src/universe";
import { OKX_MIN_LEG_USD } from "../src/legMath";

test("all static basket tickers exist in the universe", () => {
  for (const b of Object.values(BASKETS)) {
    for (const t of b.tickers) {
      expect(assetBySymbol(t), `${b.id}:${t}`).toBeDefined();
    }
  }
});

test("every static basket has enough names to diversify", () => {
  for (const b of Object.values(BASKETS)) {
    if (b.weighting === "momentum") continue;
    expect(b.tickers.length, b.id).toBeGreaterThanOrEqual(2);
  }
});

test("halal basket contains only screen-pass names", () => {
  for (const t of BASKETS["halal"].tickers) {
    expect(HALAL_SCREEN[t.toUpperCase()]?.verdict, t).toBe("pass");
  }
});

test("screen marks known exclusions with reasons and unknowns as excluded", () => {
  const [spy] = screenSymbols(["SPY"]);
  expect(spy.verdict).toBe("fail");
  expect(spy.reason.length).toBeGreaterThan(5);
  const [hood] = screenSymbols(["HOODx"]); // xStock symbol resolves to underlying
  expect(hood.verdict).toBe("fail");
  const [unknown] = screenSymbols(["ZZZZ"]);
  expect(unknown.verdict).toBe("unknown");
});

test("resolveBasket returns normalized, capped, floor-respecting allocations", async () => {
  const alloc = await resolveBasket("blue-chip", 500);
  expect(alloc.allocations.reduce((s, a) => s + a.weightPct, 0)).toBe(100);
  expect(alloc.allocations.length).toBeGreaterThanOrEqual(3);
  for (const a of alloc.allocations) {
    expect(a.weightPct).toBeLessThanOrEqual(BASKETS["blue-chip"].singleNameCapPct + 1);
    expect((a.weightPct / 100) * 500).toBeGreaterThanOrEqual(OKX_MIN_LEG_USD - 1e-6);
    expect(assetBySymbol(a.symbol)).toBeDefined();
  }
});

test("small amounts shrink the basket instead of producing dust legs", async () => {
  const alloc = await resolveBasket("dividend", 40); // $40 → at most 2 legs at $15 floor
  expect(alloc.allocations.length).toBeLessThanOrEqual(2);
  for (const a of alloc.allocations) {
    expect((a.weightPct / 100) * 40).toBeGreaterThanOrEqual(OKX_MIN_LEG_USD - 1e-6);
  }
});

test("momentum basket resolves via stats with a safe fallback", async () => {
  globalThis.fetch = (async () => {
    throw new Error("yahoo down");
  }) as never;
  const alloc = await resolveBasket("momentum", 200);
  expect(alloc.allocations.length).toBeGreaterThanOrEqual(3);
  for (const a of alloc.allocations) expect(assetBySymbol(a.symbol)).toBeDefined();
});
