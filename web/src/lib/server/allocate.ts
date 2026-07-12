import "server-only";

// buildAllocation — Vera's core allocation logic, shared by the interactive
// /api/allocate route and the autonomous Autopilot executor. Turns a plain
// goal + amount into a validated, normalized allocation over BUYABLE assets.
import { generateObject } from "ai";
import { AllocationSchema, type Allocation } from "@/lib/allocation-schema";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { resolveAllocationModel } from "./aiModel";
import { universeStatsBlock } from "./quant";
import { liquidSymbols } from "./arcus";

// Only assets that are actually buyable in one tap (exclude `coming` tiers).
const BUYABLE = ALL_ASSETS.filter((a) => !displayFor(a.symbol).coming);
const ALLOWED_SYMBOLS = new Set(BUYABLE.map((a) => a.symbol));

function systemPrompt(statsBlock: string | null): string {
  const universeStr = BUYABLE.map((a) => `${a.symbol} — ${a.name} [${a.tier}]`).join("; ");
  return [
    "You are Vera, an AI investing copilot on Robinhood Chain.",
    "You turn a person's plain-language goal into a concrete portfolio of REAL tokenized assets they can buy in one tap.",
    "",
    "RULES:",
    `- Allocate ONLY across these available assets: ${universeStr}.`,
    "- Tiers: 'stock' = tokenized equities/ETFs (e.g. AAPL, TSLA, SPY, QQQ); 'crypto' = mETH / FBTC.",
    "- There is no yield 'safe' dollar available right now. If the user wants to play it safe or keep some money low-risk, lean on broad ETFs (SPY, QQQ); never invent an asset that is not in the list above.",
    "- Weights MUST sum to exactly 100.",
    "- Diversify sensibly for the user's risk. Don't put everything in one volatile name unless they explicitly insist.",
    "- Map risk: broad ETFs ~3000-4500; single tech stocks ~5000-7000; crypto ~7000-9000. riskScore is the blended portfolio risk.",
    "- Explain like the user has never invested before. Warm, concrete, zero jargon. Briefly note that tokenized stocks track the real share price.",
    "- Writing style for ALL text fields (summary, rationale, each reason): short plain sentences. NEVER use em dashes ('—') or double hyphens ('--'); use commas, periods, colons, or parentheses instead. No marketing buzzwords (supercharge, seamless, unleash, world-class, etc.). Don't restate the goal back; get to the substance.",
    ...(statsBlock
      ? [
          "",
          "MARKET DATA (real numbers, last 12 months, per asset: 1-year return, 3-month return, annualized volatility, worst peak-to-trough dip). Use it to pick AND weight:",
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
 * Weights are filtered to known symbols and normalized to sum to 100.
 */
export async function buildAllocation(
  goal: string,
  amountUsd: number,
  riskTolerance?: string,
): Promise<Allocation> {
  // Real market stats for the whole universe (cached 6h). Best-effort: a Yahoo
  // outage degrades Vera to judgment-only, it never blocks the plan.
  const statsBlock = await universeStatsBlock(BUYABLE.map((a) => a.symbol)).catch(() => null);

  let object: Allocation;
  try {
    ({ object } = await generateObject({
      model: resolveAllocationModel(),
      schema: AllocationSchema,
      system: systemPrompt(statsBlock),
      prompt: [
        `Goal: ${goal}`,
        `Amount to invest: $${amountUsd}`,
        `Risk preference: ${riskTolerance ?? "infer from the goal"}`,
        "Build the allocation now.",
      ].join("\n"),
      // Fail fast instead of stacking the SDK's default 2 retries on top of a
      // slow provider (that turned a 13s call into 40s). One retry, and a hard
      // 28s ceiling on the whole attempt.
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(28_000),
    }));
  } catch (err) {
    // The model answered but not with parseable JSON — salvage it from the text.
    const raw = rawTextFrom(err);
    if (!raw) throw err;
    object = AllocationSchema.parse(extractJson(raw));
  }

  // Keep only known symbols (the model can hallucinate one).
  const known = object.allocations.filter((a) => ALLOWED_SYMBOLS.has(a.symbol));
  // Then drop any pick that has no live, firm-executable Arcus liquidity right
  // now, so Vera never proposes something that fails at invest ("No liquidity
  // for SOXX"). Only the chosen symbols are probed (cheap). If the probe is
  // inconclusive (Arcus unreachable), keep the picks and let the execution-time
  // guard handle it, rather than blocking the plan.
  const liquid = await liquidSymbols(known.map((a) => a.symbol)).catch(() => null);
  const filtered = liquid ? known.filter((a) => liquid.has(a.symbol)) : known;
  if (filtered.length === 0) {
    throw new Error("Could not build a valid allocation. Try rephrasing the goal.");
  }
  // Renormalize the surviving weights to sum to 100 (redistributes any dropped
  // illiquid slice across the rest).
  const total = filtered.reduce((s, a) => s + a.weightPct, 0);
  const normalized = filtered.map((a) => ({
    ...a,
    weightPct: total > 0 ? Math.round((a.weightPct / total) * 10000) / 100 : 0,
  }));

  return { ...object, allocations: normalized };
}
