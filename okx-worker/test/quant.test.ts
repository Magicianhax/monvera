import { universeStatsBlock, seriesStats, backtestBasket } from "../src/quant";

function sparkResponse(symbols: string[], closes: number[]) {
  const body: Record<string, { close: number[]; chartPreviousClose: number }> = {};
  for (const s of symbols) body[s] = { close: closes, chartPreviousClose: closes[0] };
  return new Response(JSON.stringify(body));
}

test("stats block contains one line per symbol with return/vol figures", async () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
  globalThis.fetch = (async () => sparkResponse(["AAPL", "MSFT"], closes)) as never;
  const block = await universeStatsBlock(["AAPL", "MSFT"]);
  expect(block).toContain("AAPL: 1y ");
  expect(block).toContain("MSFT: 1y ");
  expect(block).toContain("vol ");
});

test("private-company tickers report no public data instead of a fake series", async () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
  globalThis.fetch = (async () => sparkResponse(["AAPL"], closes)) as never;
  const block = await universeStatsBlock(["SPCX"]);
  expect(block).toContain("SPCX: no public data");
});

test("seriesStats computes return and drawdown", () => {
  const stats = seriesStats([100, 110, 99, 121]);
  expect(stats.returnPct).toBe(21);
  expect(stats.maxDrawdownPct).toBe(10);
});

test("backtestBasket returns a curve vs SPY benchmark", async () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
  globalThis.fetch = (async () => sparkResponse(["AAPL", "MSFT", "SPY"], closes)) as never;
  const result = await backtestBasket([
    { symbol: "AAPL", weightPct: 60 },
    { symbol: "MSFT", weightPct: 40 },
  ]);
  expect(result).not.toBeNull();
  expect(result!.coveragePct).toBe(100);
  expect(result!.benchmark.symbol).toBe("SPY");
  expect(result!.portfolio.curve[0]).toBe(100);
});
