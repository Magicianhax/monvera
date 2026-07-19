// buildAllocation — Vera's core allocation logic, adapted from
// web/src/lib/server/allocate.ts for the OKX ASP worker:
//   - universe = xStocks on Solana (src/universe.ts), not Robinhood-Chain assets
//   - liquidity gate = membership in the curated universe (live per-leg OKX
//     quotes happen in /v1/build, not here — the trial API key is ~1 RPS)
//   - leg floor = $1 dust guard (Solana swaps have no venue minimum)
//   - model injectable for tests; env passed explicitly (Workers have no process.env)
import { generateObject, type LanguageModel } from "ai";
import { AllocationSchema, type Allocation } from "./allocation-schema";
import { capAllocationLegs, SOL_MIN_LEG_USD } from "./legMath";
import { UNIVERSE } from "./universe";
import { resolveAllocationModel } from "./aiModel";
import { universeStatsBlock } from "./quant";
import type { Env } from "./env";

const ALLOWED_SYMBOLS = new Set(UNIVERSE.map((a) => a.symbol));

function systemPrompt(statsBlock: string | null): string {
  const universeStr = UNIVERSE.map((a) => `${a.symbol} — ${a.name} (${a.underlying}) [${a.kind}]`).join("; ");
  return [
    "You are Vera, an AI stock analyst. You turn a person's plain-language goal into a concrete portfolio of REAL tokenized stocks (xStocks on Solana) their own wallet can buy.",
    "This is research output, not investment advice, and your reasons must stay factual.",
    "",
    "RULES:",
    `- Allocate ONLY across these available assets (use the exact xStock symbol, e.g. AAPLx): ${universeStr}.`,
    "- If the user wants to play it safe or keep some money low-risk, lean on broad ETFs (SPYx, QQQx); never invent an asset that is not in the list above.",
    "- Weights MUST sum to exactly 100.",
    "- Diversify sensibly for the user's risk. Don't put everything in one volatile name unless they explicitly insist.",
    "- Map risk: broad ETFs ~3000-4500; single mega-cap stocks ~5000-7000; volatile names (MSTRx, COINx, HOODx) ~7000-9000. riskScore is the blended portfolio risk.",
    "- Explain like the user has never invested before. Warm, concrete, zero jargon. Briefly note that tokenized stocks track the real share price.",
    "- Writing style for ALL text fields (summary, rationale, each reason): short plain sentences. NEVER use em dashes ('—') or double hyphens ('--'); use commas, periods, colons, or parentheses instead. No marketing buzzwords (supercharge, seamless, unleash, world-class, etc.). Don't restate the goal back; get to the substance.",
    ...(statsBlock
      ? [
          "",
          "MARKET DATA (real numbers for the UNDERLYING stocks, last 12 months, per asset: 1-year return, 3-month return, annualized volatility, worst peak-to-trough dip). Use it to pick AND weight:",
          statsBlock,
          "How to use it:",
          "- Cautious goals: lean on low-vol, shallow-dip assets and broad ETFs; avoid names with dips beyond ~35% unless tiny.",
          "- Growth goals: favor strong 1y AND 3m trends (both positive beats 1y alone); a fading 3m on a big 1y is momentum rolling over.",
          "- Size positions inversely to volatility: the higher the vol, the smaller the slice, so no single name can sink the plan.",
          "- 'no public data' assets are tokenized private companies: fine as a small thematic slice (<= 10%), never a core holding.",
          "- Ground each 'reason' in these numbers when they support it (plain words, e.g. 'up 22% this year with milder swings than most tech').",
        ]
      : []),
    "",
    "OUTPUT FORMAT (critical): respond with ONLY a raw JSON object, no markdown, no code fences, no prose before or after. Shape:",
    '{"summary": string, "rationale": string, "riskScore": integer 0-10000, "allocations": [{"symbol": string, "weightPct": number, "reason": string}, ...]}',
  ].join("\n");
}

// Some OpenAI-compatible proxies (e.g. Virtuals compute) drop response_format,
// so the model can wrap or replace the JSON with prose. Salvage the object from
// the raw text instead of failing the request.
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("Model output contained no JSON object.");
}

export function rawTextFrom(err: unknown): string | undefined {
  const e = err as { text?: unknown; cause?: { text?: unknown } };
  if (typeof e?.text === "string") return e.text;
  if (typeof e?.cause?.text === "string") return e.cause.text;
  return undefined;
}

/**
 * Build a validated allocation. Throws if the model can't produce a usable plan.
 * Weights are filtered to known symbols, normalized to 100, and capped so every
 * leg clears the $15 OKX swap floor.
 */
export async function buildAllocation(
  env: Env,
  req: { goal: string; amountUsd: number; riskTolerance?: string },
  opts: { model?: LanguageModel } = {}
): Promise<Allocation> {
  // Real market stats for the whole universe (cached 6h). Best-effort: a Yahoo
  // outage degrades Vera to judgment-only, it never blocks the plan.
  const statsBlock = await universeStatsBlock(UNIVERSE.map((a) => a.underlying)).catch(() => null);

  let object: Allocation;
  try {
    ({ object } = await generateObject({
      model: opts.model ?? resolveAllocationModel(env),
      schema: AllocationSchema,
      system: systemPrompt(statsBlock),
      prompt: [
        `Goal: ${req.goal}`,
        `Amount to invest: $${req.amountUsd}`,
        `Risk preference: ${req.riskTolerance ?? "infer from the goal"}`,
        "Build the allocation now.",
      ].join("\n"),
      // Fail fast instead of stacking the SDK's default 2 retries on top of a
      // slow provider. One retry, and a hard 28s ceiling on the whole attempt.
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(28_000),
    }));
  } catch (err) {
    // The model answered but not with parseable JSON — salvage it from the text.
    const raw = rawTextFrom(err);
    if (!raw) throw err;
    object = AllocationSchema.parse(extractJson(raw));
  }

  // Keep only known symbols (the model can hallucinate one). The model may
  // also answer with the underlying ticker (AAPL) — map it to the xStock.
  const bySymbol = new Map(UNIVERSE.map((a) => [a.symbol.toLowerCase(), a.symbol]));
  const byUnderlying = new Map(UNIVERSE.map((a) => [a.underlying.toLowerCase(), a.symbol]));
  const known = object.allocations.flatMap((a) => {
    const resolved = bySymbol.get(a.symbol.toLowerCase()) ?? byUnderlying.get(a.symbol.toLowerCase());
    return resolved && ALLOWED_SYMBOLS.has(resolved) ? [{ ...a, symbol: resolved }] : [];
  });
  if (known.length === 0) {
    throw new Error("Could not build a valid allocation. Try rephrasing the goal.");
  }

  // Renormalize the surviving weights to sum to 100.
  const total = known.reduce((s, a) => s + a.weightPct, 0);
  const normalized = known.map((a) => ({
    ...a,
    weightPct: total > 0 ? Math.round((a.weightPct / total) * 10000) / 100 : 0,
  }));

  // Cap the plan so every leg clears the dust floor once the amount is split
  // by weight — slivers aren't worth the swap fees.
  const capped = capAllocationLegs(normalized, req.amountUsd, SOL_MIN_LEG_USD);

  return { ...object, allocations: capped };
}
