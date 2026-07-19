import { handleBacktest } from "../src/handlers/backtest";
import { handleRebalance } from "../src/handlers/rebalance";
import { handleScreener } from "../src/handlers/screener";
import { OKX_MIN_LEG_USD } from "../src/legMath";

function post(path: string, body: unknown): Request {
  return new Request(`https://asp.example${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function sparkResponse(symbols: string[], closes: number[]) {
  const body: Record<string, { close: number[]; chartPreviousClose: number }> = {};
  for (const s of symbols) body[s] = { close: closes, chartPreviousClose: closes[0] };
  return new Response(JSON.stringify(body));
}

test("backtest rejects unknown symbols before fetching data", async () => {
  const r = await handleBacktest(post("/v1/backtest", { allocations: [{ symbol: "DOGE", weightPct: 100 }] }));
  expect(r.status).toBe(400);
});

test("backtest runs on universe symbols", async () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
  globalThis.fetch = (async () => sparkResponse(["AAPL", "MSFT", "SPY"], closes)) as never;
  const r = await handleBacktest(
    post("/v1/backtest", {
      allocations: [
        { symbol: "AAPLx", weightPct: 60 },
        { symbol: "MSFT", weightPct: 40 },
      ],
    })
  );
  expect(r.status).toBe(200);
  const body = (await r.json()) as { backtest: { benchmark: { symbol: string } } };
  expect(body.backtest.benchmark.symbol).toBe("SPY");
});

test("rebalance produces sells before buys and skips dust diffs", async () => {
  const r = await handleRebalance(
    post("/v1/rebalance", {
      holdings: [
        { symbol: "AAPLx", usdValue: 200 },
        { symbol: "TSLAx", usdValue: 100 },
      ],
      target: [
        { symbol: "AAPLx", weightPct: 50 },
        { symbol: "NVDAx", weightPct: 50 },
      ],
    })
  );
  expect(r.status).toBe(200);
  const body = (await r.json()) as {
    legs: Array<{ action: string; symbol: string; approxUsd: number }>;
    totalUsd: number;
  };
  expect(body.totalUsd).toBe(300);
  const actions = body.legs.map((l) => l.action);
  expect(actions.indexOf("sell")).toBeLessThan(actions.lastIndexOf("buy"));
  const tsla = body.legs.find((l) => l.symbol === "TSLAx");
  expect(tsla?.action).toBe("sell");
  expect(tsla?.approxUsd).toBe(100);
  const nvda = body.legs.find((l) => l.symbol === "NVDAx");
  expect(nvda?.action).toBe("buy");
  expect(nvda?.approxUsd).toBe(150);
  for (const leg of body.legs) expect(leg.approxUsd).toBeGreaterThanOrEqual(OKX_MIN_LEG_USD);
});

test("rebalance rejects weights that do not sum to 100", async () => {
  const r = await handleRebalance(
    post("/v1/rebalance", {
      holdings: [{ symbol: "AAPLx", usdValue: 100 }],
      target: [{ symbol: "AAPLx", weightPct: 60 }],
    })
  );
  expect(r.status).toBe(400);
});

test("screener returns ranked rows from real stats", async () => {
  const up = Array.from({ length: 260 }, (_, i) => 100 + i * 0.3);
  const flat = Array.from({ length: 260 }, () => 100 + Math.sin(0) * 0);
  globalThis.fetch = (async () => {
    const body: Record<string, { close: number[]; chartPreviousClose: number }> = {};
    body["NVDA"] = { close: up, chartPreviousClose: up[0] };
    body["KO"] = { close: flat.map((v, i) => v + (i % 2 ? 0.01 : -0.01)), chartPreviousClose: 100 };
    return new Response(JSON.stringify(body));
  }) as never;
  const r = await handleScreener();
  expect(r.status).toBe(200);
  const body = (await r.json()) as { ranked: Array<{ rank: number; symbol: string }> };
  expect(body.ranked.length).toBeGreaterThanOrEqual(1);
  expect(body.ranked[0].rank).toBe(1);
});
