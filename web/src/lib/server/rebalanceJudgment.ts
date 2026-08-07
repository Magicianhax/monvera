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
  "Defer ONLY for a genuinely violent move in a name the plan touches: roughly 4% or more on the day, or a clear gap on news. A mega-cap up 2% or down 3% is an ordinary session, not a live move, and is NOT a reason to wait.",
  "Proceed otherwise. Realigning on an ordinary day is the normal case and what you are for.",
  "Do not defer merely because several names are green or red today, because volatility is elevated in the abstract, or because a calmer window might exist later. There is always a calmer window; a basket that waits for it is never managed.",
  "The brief states whether the US reference session is OPEN or CLOSED. When it is CLOSED, every day-move figure you are given is a SETTLED CLOSING number, not a live move: the tape cannot change until the next open. Never defer to let such a move finish, cool off or settle — it already has, and no name can be \"still running\" or \"mid-move\" outside the session.",
  "A closed session never prevents execution: the basket itself trades around the clock. It is a reason to proceed, not to wait.",
  "When uncertain, PROCEED — the math already justified this plan, the caps already bound it, and drift left alone compounds.",
  "Answer with the verdict and ONE honest sentence of reason, in plain words a customer can read.",
  "The reason must name at least one drifted holding by its exact symbol and cite at least one figure from the data you were given (a weight, a deviation, a day move).",
  "EVERY number you write must be COPIED from the data above. Do not compute new figures, do not estimate, do not round beyond the one decimal place shown, and never introduce a number that is not in front of you. A reason containing an unsupported figure is discarded and the holder is shown a generic sentence instead — so an invented number costs them the explanation entirely.",
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

/** How close a written number must be to one the model was actually shown.
 *  Every figure in the brief is rendered to one decimal place, so a correct
 *  quotation lands on it exactly; the slack only forgives honest rounding
 *  ("2.3 points" for a 2.25 deviation), never an invented figure. */
const FIGURE_TOLERANCE = 0.15;

/** True when the reason cites a figure the model was ACTUALLY GIVEN, names at
 *  least one brief symbol, and makes no forward-looking claim.
 *
 *  The numeral check used to be `/\d/.test(reason)` — it asked whether a digit
 *  was present, not whether it was true. A reason carrying the right ticker, a
 *  confident invented number and calm phrasing passed, and passing means shown
 *  verbatim to a holder whose money just moved. Grounding every numeral against
 *  `figures` closes that: the model may still be wrong about what a number
 *  MEANS, but it can no longer state one it was never shown.
 *
 *  Wording quality only — never gates the verdict itself. A failure is recorded
 *  in the ledger and displayReason() substitutes a sentence that claims nothing. */
export function lintVerdictReason(reason: string, briefSymbols: string[], figures: number[]): boolean {
  const written = reason.match(/\d+(?:\.\d+)?/g);
  if (!written) return false;
  const grounded = written.every((tok) => {
    const n = Number(tok);
    return Number.isFinite(n) && figures.some((f) => Math.abs(f - n) <= FIGURE_TOLERANCE);
  });
  if (!grounded) return false;
  const named = briefSymbols.some((sym) => new RegExp(`\\b${escapeRegExp(sym)}\\b`, "i").test(reason));
  if (!named) return false;
  return !FORWARD_LOOKING.some((p) => p.test(reason));
}

/** A verdict WE wrote, not the model.
 *
 *  Hand-written sentences are safe verbatim and must never be judged by a lint
 *  built for model prose — that lint requires a brief symbol, which our own
 *  copy has no reason to contain. Getting this wrong is not hypothetical: the
 *  defer-streak override's sentence carried lintOk:false, so both real trades of
 *  the 2026-08-05 18:00 window showed holders a generic fallback instead of the
 *  honest "waited 3 windows" explanation. Constructing our sentences through
 *  here makes that impossible rather than merely fixed. */
export function ourVerdict(action: RebalanceVerdict["action"], reason: string, source: RebalanceVerdict["source"] = "outage"): RebalanceVerdict {
  return { action, reason, source, lintOk: true };
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

/** Whether the US reference session (09:30–16:00 New York) is open right now.
 *
 *  CONTEXT FOR THE PROMPT ONLY — this deliberately gates nothing. A wall-clock
 *  market-hours gate on execution was tried and dropped as TradFi cosplay (see
 *  feedFresh in autoRebalance.ts): the tokenized basket trades around the clock
 *  and the oracle's own freshness is the only real session gate. Nothing here
 *  may ever decide whether a rebalance runs.
 *
 *  It exists because three of the five daily windows — 00:00, 06:00 and 12:00
 *  UTC — land outside the session, where every "today" figure is the previous
 *  close. On 2026-08-05 Vera deferred those three windows running against the
 *  SAME frozen tape, calling settled closes "a live move" and "still running",
 *  and the defer-streak cap had to rescue a basket waiting on news that could
 *  not arrive. She was reasoning correctly from context she did not have.
 *
 *  Timezone-aware via Intl rather than a fixed UTC offset, so DST needs no
 *  upkeep. Market holidays are NOT modelled: on one, this reads open and the
 *  prompt simply omits the hint — which is exactly the behaviour that shipped
 *  before, so the failure direction is "no worse than today". */
export function referenceSessionOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = part("weekday");
  if (day === "Sat" || day === "Sun") return false;
  // hour12:false renders midnight as "24" in some ICU builds; fold it to 0.
  const minutes = (Number(part("hour")) % 24) * 60 + Number(part("minute"));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function fmt(n: number | null | undefined, suffix = "%"): string {
  return n == null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}${suffix}`;
}

/** Never throws. Every failure is a defer with an honest reason and
 *  source "outage"; only a real provider answer carries source "model". */
export async function judgeRebalance(brief: RebalanceBrief): Promise<RebalanceVerdict> {
  const symbols = brief.rows.map((r) => r.symbol);
  let prompt: string;
  // Every number the model is SHOWN, collected as the prompt is built so the two
  // cannot drift: the lint below only accepts numerals drawn from this set, so a
  // figure added to the prompt without being added here would be flagged as
  // invented, and one removed from the prompt stops being quotable. Rounded the
  // same way it is rendered, because that is the form the model reads.
  const figures: number[] = [];
  const show = (n: number | null | undefined, dp: number): void => {
    if (n != null && Number.isFinite(n)) figures.push(Number(Math.abs(n).toFixed(dp)));
  };
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
      show(r.currentWeightPct, 1);
      show(r.targetWeightPct, 1);
      show(r.deviationPct, 1);
      show(d?.dayChangePct, 1);
      show(s?.ret3mPct, 1);
      show(s?.volPct, 1);
      show(s?.maxDrawdownPct, 1);
      show(h?.ageH, 0);
      return (
        `${r.symbol}: weight ${r.currentWeightPct.toFixed(1)}% vs target ${r.targetWeightPct.toFixed(1)}% ` +
        `(${r.deviationPct >= 0 ? "overweight, plan sells" : "underweight, plan buys"}) · ` +
        `today ${fmt(d?.dayChangePct)} · 3m ${fmt(s?.ret3mPct)} · vol ${fmt(s?.volPct)} · maxDD ${fmt(s?.maxDrawdownPct != null ? -s.maxDrawdownPct : null)}` +
        (h ? ` · headline: "${h.title.slice(0, 110)}" (${h.ageH}h ago)` : "")
      );
    });
    show(brief.turnoverUsd, 0);
    show(brief.maxDeviationBps / 100, 1);
    prompt = [
      `Grove: ${brief.groveName}. Planned turnover ~$${brief.turnoverUsd.toFixed(0)}; worst weight deviation ${(brief.maxDeviationBps / 100).toFixed(1)} points.`,
      referenceSessionOpen()
        ? "US reference session: OPEN — the day moves below are live intraday figures."
        : "US reference session: CLOSED — the day moves below are settled closing figures and cannot change until the next open.",
      "Holdings the plan touches:",
      ...lines,
      "",
      "Run it in this window, or wait?",
    ].join("\n");
  } catch (err) {
    console.error("[rebalance-judgment] brief build failed", err);
    return ourVerdict("defer", "Market data was unavailable, so the rebalance waits for the next window.");
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
      return { ...object, source: "model", lintOk: lintVerdictReason(object.reason, symbols, figures) };
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("[rebalance-judgment] all providers failed", lastErr);
  return ourVerdict("defer", "Vera couldn't complete her market check, so the rebalance waits for the next window.");
}
