// LIVE smoke test for Vera's structured-output path. Unlike the other scripts
// in here it DOES hit the network and the configured model provider, so it is
// not part of the deterministic gate — run it by hand after changing the model
// layer, the provider, or the model id:
//
//   npx tsx --conditions=react-server scripts/ai-smoke.ts
//
// Why it exists: on 2026-08-04 Virtuals' OpenAI-compatible proxy turned out to
// support neither responseFormat nor tool-calling, so every generateObject call
// failed and Vera's judgment was inert in production for as long as that was
// the only provider — rebalances always deferred and news alerts never sent.
// Nothing caught it because nothing exercised the model path end to end. This
// asks both real call sites' schemas for a real answer and prints what came
// back. Exit code is non-zero if either fails.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
// Safe as a static import: the provider keys are read lazily inside
// buildModel(), so loading .env.local below still takes effect.
import { generateJson, resolveModelChain } from "../src/lib/server/aiModel";

// tsx does not load .env.local the way Next does.
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

let failed = 0;

async function main() {
const chain = resolveModelChain();
console.log(`providers: ${chain.map((c) => c.provider).join(", ") || "(none)"}`);

for (const { provider, model } of chain) {
  // 1. The rebalance verdict (rebalanceJudgment.ts).
  try {
    const v = await generateJson({
      model,
      schema: z.object({ action: z.enum(["proceed", "defer"]), reason: z.string().max(240) }),
      shape: '{"action": "proceed" | "defer", "reason": "one plain sentence"}',
      system:
        "You are Vera deciding the TIMING of one basket rebalance. Answer with the verdict and ONE sentence naming a symbol and citing a figure. Report only what already happened; never predict.",
      prompt:
        "Grove: Titan Grove. Planned turnover ~$40; worst weight deviation 6.2 points.\n" +
        "NVDA: weight 20.2% vs target 14.0% (overweight, plan sells) - today +8.4% - vol +42.0%\n" +
        "TSLA: weight 7.1% vs target 11.0% (underweight, plan buys) - today -5.1% - vol +55.0%\n\n" +
        "Run it in this window, or wait?",
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(45_000),
    });
    console.log(`  ${provider} verdict   OK   ${JSON.stringify(v)}`);
  } catch (err) {
    failed++;
    console.error(`  ${provider} verdict   FAILED  ${String((err as Error).message).slice(0, 200)}`);
  }

  // 2. The news classification (newsAlerts.ts) — the batched, harder shape.
  try {
    const c = await generateJson({
      model,
      schema: z.object({
        items: z
          .array(
            z.object({
              id: z.number().int(),
              symbol: z.string(),
              severity: z.enum(["high", "medium", "low"]),
              direction: z.enum(["negative", "positive", "neutral"]),
              line: z.string().max(180),
            }),
          )
          .max(24),
      }),
      shape:
        '{"items": [{"id": 1, "symbol": "NVDA", "severity": "high" | "medium" | "low", "direction": "negative" | "positive" | "neutral", "line": "one plain sentence"}]}',
      system:
        "You are Vera triaging news about stocks customers own. high = a specific material company-level event that ALREADY happened. low = opinion, or a story really about a different company. One plain sentence naming the exact ticker. Never predict.",
      prompt:
        "Classify each headline below. Answer with one entry per id.\n\n=== UNTRUSTED DATA START ===\n" +
        "[1] NVDA | Reuters | Nvidia says Q3 revenue rose 22% on data-center demand | Reported after the close.\n" +
        "[2] AAPL | Motley Fool | Is Apple stock a buy right now? | An analyst weighs the case.\n" +
        "=== UNTRUSTED DATA END ===",
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(45_000),
    });
    const sev = c.items.map((i) => `${i.symbol}:${i.severity}`).join(" ");
    console.log(`  ${provider} classify  OK   ${c.items.length} item(s)  ${sev}`);
  } catch (err) {
    failed++;
    console.error(`  ${provider} classify  FAILED  ${String((err as Error).message).slice(0, 200)}`);
  }
}

}

main().then(() => {
  console.log(failed === 0 ? "\nai-smoke: structured output works" : `\nai-smoke: ${failed} failure(s)`);
  process.exit(failed === 0 ? 0 : 1);
});
