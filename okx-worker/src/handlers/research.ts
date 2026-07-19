import { generateText } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson, requestInput } from "../respond";
import { assetBySymbol } from "../universe";
import { resolveAllocationModel } from "../aiModel";
import { universeStatsBlock } from "../quant";
import { DISCLAIMER } from "../respond";
import { notRecorded } from "../record";

const RequestSchema = z.object({ symbol: z.string().min(1).max(12) });

export async function handleResearch(request: Request, env: Env): Promise<Response> {
  const parsed = RequestSchema.safeParse(await requestInput(request));
  if (!parsed.success) return errorJson(400, "Body must be { symbol: string }.");
  const asset = assetBySymbol(parsed.data.symbol);
  if (!asset) return errorJson(404, `Unknown symbol: ${parsed.data.symbol}`);

  const stats = await universeStatsBlock([asset.underlying]).catch(() => null);
  try {
    const { text } = await generateText({
      model: resolveAllocationModel(env),
      system: [
        "You are Vera, an AI stock analyst writing a compact research note on ONE tokenized stock (an xStock on Solana tracking the real equity).",
        "Structure: what the company does (2 sentences), the 12-month picture from the data below, key risk, who this fits. 120-180 words.",
        "Factual, warm, zero jargon, no hype. NEVER use em dashes or double hyphens. Note that the token tracks the real share price.",
        ...(stats ? ["", "MARKET DATA (real, last 12 months):", stats] : []),
      ].join("\n"),
      prompt: `Write the research note for ${asset.symbol} (${asset.name}, underlying ${asset.underlying}).`,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(28_000),
    });
    return json({
      symbol: asset.symbol,
      underlying: asset.underlying,
      note: text,
      record: notRecorded("research notes are not committed on-chain by design"),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    console.error("research failed", err);
    return errorJson(502, "Research generation failed. Try again.");
  }
}
