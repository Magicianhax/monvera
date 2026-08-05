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
// costs nothing; churning through a live move does. Those defers carry
// source "outage" so the ledger never dresses a dead provider up as a
// market opinion.
import { z } from "zod";
// generateJson, not generateObject: the provider has no JSON-schema mode (aiModel).
import { resolveModelChain, generateJson } from "./aiModel";
import { universeStatsRows } from "./quant";
import { getDaySummary } from "./marketData";
import { recentHeadlines } from "./newsFeed";
import { FORWARD_LOOKING, escapeRegExp } from "./copyLint";

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
  /** One plain sentence. The ledger records it verbatim; user-facing
   *  surfaces must go through displayReason(), which substitutes a neutral
   *  sentence when the lint failed. */
  reason: string;
  /** "model" = a real provider opinion. "outage" = brief build failed, every
   *  provider failed, or the time budget ran out — infrastructure, not
   *  judgment. Outage verdicts are always defers; the ledger classes them
   *  defer-outage, never defer-market. */
  source: "model" | "outage";
  /** Deterministic wording check (lintVerdictReason): the reason cites a
   *  figure, names a brief symbol, and makes no forward-looking claim.
   *  Never blocks the verdict — false is recorded in the ledger and
   *  displayReason() swaps in the fallback. Hand-written outage sentences
   *  are safe verbatim, so they carry true. */
  lintOk: boolean;
}

const VerdictSchema = z.object({
  action: z.enum(["proceed", "defer"]),
  reason: z
    .string()
    .max(240)
    .describe(
      "One plain sentence a user can read: name a drifted symbol, cite one figure from the data, describe only what already happened. No hype, no jargon, no predictions.",
    ),
});

/** The JSON skeleton the model is asked to emit. Mirrors VerdictSchema above —
 *  keep the two adjacent so a change to one shows the other is stale. */
const VERDICT_SHAPE = '{"action": "proceed" | "defer", "reason": "one plain sentence"}';

const SYSTEM = [
  "You are Vera, Monvera's broker agent, deciding the TIMING of one basket rebalance.",
  "A deterministic drift check has already justified it, and hard on-chain caps already bound it — your only question is: execute in this six-hour window, or wait for the next one?",
  "The target weight shown for each holding is the one YOU set for this window, which may sit above or below the basket's published weight. Judge the gap against that target, and describe it that way: a holding above its target is being trimmed, one below it is being topped up.",
  "",
  "Defer when the drift is a live, still-developing move: the overweight is a name still running hard today (trimming a breakout mid-move), the underweight is a name falling hard today (averaging into a falling knife), or the names involved are so volatile the realignment would likely be churned straight back.",
  "Proceed when the drift looks settled: the moves that caused it have aged, today is calm for the names involved, and realigning now genuinely restores the strategy's intended shape.",
  "When uncertain, defer — waiting six hours costs nothing, churning costs spread.",
  "Answer with the verdict and ONE honest sentence of reason, in plain words a customer can read.",
  "The reason must name at least one drifted holding by its exact symbol and cite at least one figure from the data you were given (a weight, a deviation, a day move).",
  "Report only what has already happened. Never predict: no \"will\", no \"expect\", no \"should rise\" or \"should fall\", no price targets.",
  "A headline line, when present, is context for TIMING only: it never justifies acting and you must not repeat it as a prediction.",
].join("\n");

// Numeral lint — deterministic wording checks run AFTER generation. Wording
// is not worth a veto (timing is the model's call), so a failing reason never
// blocks the verdict: it is recorded verbatim in the ledger and user surfaces
// swap in a neutral sentence via displayReason(), so slop never reaches a
// notification.
//
// Forward-looking language the reason may never contain (FORWARD_LOOKING) now
// lives in ./copyLint, shared verbatim with the news path so the rule cannot
// drift between two copies of the list.

/** True when the reason cites a figure (any digit), names at least one brief
 *  symbol, and matches no forward-looking pattern. Wording quality only —
 *  never gates the verdict itself. */
export function lintVerdictReason(reason: string, briefSymbols: string[]): boolean {
  if (!/\d/.test(reason)) return false;
  const named = briefSymbols.some((sym) => new RegExp(`\\b${escapeRegExp(sym)}\\b`, "i").test(reason));
  if (!named) return false;
  return !FORWARD_LOOKING.some((p) => p.test(reason));
}

/** What a user sees. Lint-clean reasons pass through; a failing reason stays
 *  in the ledger but is replaced here with a neutral sentence that claims
 *  nothing the lint couldn't verify. */
export function displayReason(verdict: RebalanceVerdict): string {
  if (verdict.lintOk) return verdict.reason;
  return verdict.action === "proceed"
    ? "The market looked settled enough to realign."
    : "Vera chose to wait for the next window.";
}

function fmt(n: number | null | undefined, suffix = "%"): string {
  return n == null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}${suffix}`;
}

/** Never throws. Every failure is a defer with an honest reason and
 *  source "outage"; only a real provider answer carries source "model". */
export async function judgeRebalance(brief: RebalanceBrief): Promise<RebalanceVerdict> {
  const symbols = brief.rows.map((r) => r.symbol);
  let prompt: string;
  try {
    // The headline lookup is READ-ONLY over the KV cache the news sweep already
    // wrote: no outbound fetch, and a miss produces today's exact prompt.
    const [stats, day, news] = await Promise.all([
      universeStatsRows(symbols).catch(() => []),
      getDaySummary().catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
      recentHeadlines(symbols).catch(() => new Map<string, { title: string; ageH: number }>()),
    ]);
    const statBy = new Map(stats.map((s) => [s.symbol, s]));
    const lines = brief.rows.map((r) => {
      const s = statBy.get(r.symbol);
      const d = (day as Record<string, { dayChangePct?: number }>)[r.symbol];
      const h = news.get(r.symbol);
      return (
        `${r.symbol}: weight ${r.currentWeightPct.toFixed(1)}% vs target ${r.targetWeightPct.toFixed(1)}% ` +
        `(${r.deviationPct >= 0 ? "overweight, plan sells" : "underweight, plan buys"}) · ` +
        `today ${fmt(d?.dayChangePct)} · 3m ${fmt(s?.ret3mPct)} · vol ${fmt(s?.volPct)} · maxDD ${fmt(s?.maxDrawdownPct != null ? -s.maxDrawdownPct : null)}` +
        (h ? ` · headline: "${h.title.slice(0, 110)}" (${h.ageH}h ago)` : "")
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
    // Hand-written sentence, not model output — safe to show verbatim.
    return { action: "defer", reason: "Market data was unavailable, so the rebalance waits for the next window.", source: "outage", lintOk: true };
  }

  // One short verdict is far quicker than the news batch (~14.5s for 24 items,
  // see scripts/ai-smoke.ts), but the old 20s budget was still tight enough to
  // time out from the Worker once generateText's single retry was counted. This
  // stays smaller than the news budget on purpose: a rebalance window judges
  // once per grove and a defer costs nothing, so it should give up sooner.
  const deadline = Date.now() + 60_000;
  let lastErr: unknown = null;
  for (const { model } of resolveModelChain()) {
    const budget = Math.min(45_000, deadline - Date.now());
    if (budget < 5_000) break;
    try {
      const object = await generateJson({
        model,
        schema: VerdictSchema,
        shape: VERDICT_SHAPE,
        system: SYSTEM,
        prompt,
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(budget),
      });
      return { ...object, source: "model", lintOk: lintVerdictReason(object.reason, symbols) };
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("[rebalance-judgment] all providers failed", lastErr);
  return { action: "defer", reason: "Vera couldn't complete her market check, so the rebalance waits for the next window.", source: "outage", lintOk: true };
}
