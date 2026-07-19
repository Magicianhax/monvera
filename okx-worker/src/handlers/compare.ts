// Paid: head-to-head research note on two tokenized stocks.
import { generateText } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson, requestInput } from "../respond";
import { assetBySymbol } from "../universe";
import { resolveAllocationModel } from "../aiModel";
import { universeStatsBlock } from "../quant";
import { DISCLAIMER } from "./plan";

const RequestSchema = z.object({
  symbolA: z.string().min(1).max(12),
  symbolB: z.string().min(1).max(12),
  goal: z.string().max(300).optional(),
});

export async function handleCompare(request: Request, env: Env): Promise<Response> {
  const parsed = RequestSchema.safeParse(await requestInput(request));
  if (!parsed.success) {
    return errorJson(400, "Body must be { symbolA: string, symbolB: string, goal?: string }.");
  }
  const a = assetBySymbol(parsed.data.symbolA);
  const b = assetBySymbol(parsed.data.symbolB);
  if (!a || !b) {
    return errorJson(404, `Unknown symbol: ${!a ? parsed.data.symbolA : parsed.data.symbolB}.`);
  }
  if (a.symbol === b.symbol) return errorJson(400, "Pick two different stocks to compare.");

  const stats = await universeStatsBlock([a.underlying, b.underlying]).catch(() => null);
  try {
    const { text } = await generateText({
      model: resolveAllocationModel(env),
      system: [
        "You are Vera, an AI stock analyst comparing TWO tokenized stocks (xStocks tracking the real equities) head to head.",
        "Structure: one short paragraph per stock (what it is + the 12-month picture), then a direct comparison (risk, trend, valuation angle), then a clear verdict for the stated goal (or a balanced 'it depends' split if no goal). 150-220 words.",
        "Factual, warm, zero jargon, no hype. NEVER use em dashes or double hyphens. Note that the tokens track the real share prices.",
        ...(stats ? ["", "MARKET DATA (real, last 12 months):", stats] : []),
      ].join("\n"),
      prompt: [
        `Compare ${a.symbol} (${a.name}) vs ${b.symbol} (${b.name}).`,
        parsed.data.goal ? `The user's goal: ${parsed.data.goal}` : "No specific goal given.",
      ].join("\n"),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(28_000),
    });
    return json({ symbolA: a.symbol, symbolB: b.symbol, note: text, disclaimer: DISCLAIMER });
  } catch (err) {
    console.error("compare failed", err);
    return errorJson(502, "Comparison generation failed. Try again.");
  }
}
