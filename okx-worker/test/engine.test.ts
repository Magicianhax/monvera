import { buildAllocation, extractJson } from "../src/engine";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";

function mockModel(allocations: Array<{ symbol: string; weightPct: number; reason: string }>): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ summary: "s", rationale: "r", riskScore: 4000, allocations }),
        },
      ],
      warnings: [],
    }),
  }) as unknown as LanguageModel;
}

const env = {} as never; // engine must not need secrets when a model is injected

beforeEach(() => {
  // Stats sweep degrades gracefully on failure — feed it an empty spark payload.
  globalThis.fetch = (async () => new Response(JSON.stringify({}))) as never;
});

test("keeps only universe symbols and renormalizes to 100", async () => {
  const out = await buildAllocation(
    env,
    { goal: "steady growth", amountUsd: 200 },
    {
      model: mockModel([
        { symbol: "AAPLx", weightPct: 50, reason: "a" },
        { symbol: "FAKECOIN", weightPct: 30, reason: "b" },
        { symbol: "MSFTx", weightPct: 20, reason: "c" },
      ]),
    }
  );
  const symbols = out.allocations.map((a) => a.symbol);
  expect(symbols).not.toContain("FAKECOIN");
  expect(out.allocations.reduce((s, a) => s + a.weightPct, 0)).toBe(100);
});

test("maps underlying tickers to xStock symbols", async () => {
  const out = await buildAllocation(
    env,
    { goal: "g", amountUsd: 100 },
    {
      model: mockModel([
        { symbol: "AAPL", weightPct: 60, reason: "a" },
        { symbol: "NVDA", weightPct: 40, reason: "b" },
      ]),
    }
  );
  expect(out.allocations.map((a) => a.symbol).sort()).toEqual(["AAPLx", "NVDAx"]);
});

test("caps legs to the $15 OKX floor", async () => {
  const out = await buildAllocation(
    env,
    { goal: "g", amountUsd: 50 },
    {
      model: mockModel([
        { symbol: "AAPLx", weightPct: 80, reason: "a" },
        { symbol: "MSFTx", weightPct: 10, reason: "b" },
        { symbol: "NVDAx", weightPct: 10, reason: "c" },
      ]),
    }
  );
  for (const a of out.allocations) {
    expect((a.weightPct / 100) * 50).toBeGreaterThanOrEqual(15 - 1e-6);
  }
});

test("throws a clear error when nothing survives the universe filter", async () => {
  await expect(
    buildAllocation(
      env,
      { goal: "g", amountUsd: 100 },
      { model: mockModel([{ symbol: "DOGE", weightPct: 100, reason: "x" }]) }
    )
  ).rejects.toThrow(/valid allocation/);
});

test("extractJson salvages fenced and embedded objects", () => {
  expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(extractJson('the plan is {"b":2} thanks')).toEqual({ b: 2 });
  expect(() => extractJson("no json here")).toThrow();
});
