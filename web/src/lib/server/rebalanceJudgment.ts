import "server-only";

// Vera's timing judgment on a rebalance the MATH already justified.
//
// Strict division of labor, so a model can never endanger money:
//   - The pure planner (rebalancePlan.ts) decides WHETHER a rebalance is
//     justified — deterministic drift arithmetic, proven by its test script.
//   - The contract decides WHAT IS ALLOWED — the user's caps, on every call.
//   - Vera decides only WHEN: run this justified, capped plan now, or let it
//     wait for the next six-hour window. She can veto; she cannot initiate,
//     enlarge, or redirect anything.
//
// Fail-safe direction: rebalancing is never urgent, so every failure mode —
// provider down, junk output, timeout — resolves to "defer" and the next
// window looks again. A basket a few points off target for six more hours
// costs nothing; churning through a live move does.
import { z } from "zod";
import { generateObject } from "ai";
import { resolveModelChain } from "./aiModel";
import { universeStatsRows } from "./quant";
import { getDaySummary } from "./marketData";

export interface JudgmentRow {
  symbol: string;
  currentWeightPct: number;
  targetWeightPct: number;
  /** Positive = overweight (the plan sells it), negative = underweight (buys). */
  deviationPct: number;
}

export interface RebalanceBrief {
  groveName: string;
  rows: JudgmentRow[];
  turnoverUsd: number;
  maxDeviationBps: number;
}

export interface RebalanceVerdict {
  action: "proceed" | "defer";
  /** One plain sentence, safe to show the user in their notification. */
  reason: string;
}

const VerdictSchema = z.object({
  action: z.enum(["proceed", "defer"]),
  reason: z
    .string()
    .max(240)
    .describe("One plain sentence a user can read: why now, or why waiting is smarter. No hype, no jargon."),
});

const SYSTEM = [
  "You are Vera, Monvera's broker agent, deciding the TIMING of one basket rebalance.",
  "A deterministic drift check has already justified it, and hard on-chain caps already bound it — your only question is: execute in this six-hour window, or wait for the next one?",
  "",
  "Defer when the drift is a live, still-developing move: the overweight is a name still running hard today (trimming a breakout mid-move), the underweight is a name falling hard today (averaging into a falling knife), or the names involved are so volatile the realignment would likely be churned straight back.",
  "Proceed when the drift looks settled: the moves that caused it have aged, today is calm for the names involved, and realigning now genuinely restores the strategy's intended shape.",
  "When uncertain, defer — waiting six hours costs nothing, churning costs spread.",
  "Answer with the verdict and ONE honest sentence of reason, in plain words a customer can read.",
].join("\n");

function fmt(n: number | null | undefined, suffix = "%"): string {
  return n == null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}${suffix}`;
}

/** Never throws. Every failure is a defer with an honest reason. */
export async function judgeRebalance(brief: RebalanceBrief): Promise<RebalanceVerdict> {
  let prompt: string;
  try {
    const symbols = brief.rows.map((r) => r.symbol);
    const [stats, day] = await Promise.all([
      universeStatsRows(symbols).catch(() => []),
      getDaySummary().catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
    ]);
    const statBy = new Map(stats.map((s) => [s.symbol, s]));
    const lines = brief.rows.map((r) => {
      const s = statBy.get(r.symbol);
      const d = (day as Record<string, { dayChangePct?: number }>)[r.symbol];
      return (
        `${r.symbol}: weight ${r.currentWeightPct.toFixed(1)}% vs target ${r.targetWeightPct.toFixed(1)}% ` +
        `(${r.deviationPct >= 0 ? "overweight, plan sells" : "underweight, plan buys"}) · ` +
        `today ${fmt(d?.dayChangePct)} · 3m ${fmt(s?.ret3mPct)} · vol ${fmt(s?.volPct)} · maxDD ${fmt(s?.maxDrawdownPct != null ? -s.maxDrawdownPct : null)}`
      );
    });
    prompt = [
      `Grove: ${brief.groveName}. Planned turnover ~$${brief.turnoverUsd.toFixed(0)}; worst weight deviation ${(brief.maxDeviationBps / 100).toFixed(1)} points.`,
      "Holdings the plan touches:",
      ...lines,
      "",
      "Run it in this window, or wait?",
    ].join("\n");
  } catch (err) {
    console.error("[rebalance-judgment] brief build failed", err);
    return { action: "defer", reason: "Market data was unavailable, so the rebalance waits for the next window." };
  }

  const deadline = Date.now() + 25_000;
  let lastErr: unknown = null;
  for (const { model } of resolveModelChain()) {
    const budget = Math.min(20_000, deadline - Date.now());
    if (budget < 3_000) break;
    try {
      const { object } = await generateObject({
        model,
        schema: VerdictSchema,
        system: SYSTEM,
        prompt,
        temperature: 0.2,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(budget),
      });
      return object;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("[rebalance-judgment] all providers failed", lastErr);
  return { action: "defer", reason: "Vera couldn't complete her market check, so the rebalance waits for the next window." };
}
