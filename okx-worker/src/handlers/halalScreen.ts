import { z } from "zod";
import { json, errorJson, requestInput } from "../respond";
import { screenSymbols } from "../baskets";
import { normalizeForRoute } from "../precheck";
import { notRecorded } from "../record";

const RequestSchema = z.object({ symbols: z.array(z.string().min(1).max(12)).min(1).max(50) });

export async function handleHalalScreen(request: Request): Promise<Response> {
  const input = normalizeForRoute("/v1/halal-screen", await requestInput(request));
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return errorJson(400, 'Provide "symbols" — CSV in the query string or a string[] body (1-50 tickers).');
  return json({
    results: screenSymbols(parsed.data.symbols),
    methodology:
      "AAOIFI sector and ratio screens (no banking, insurance, gambling, alcohol, weapons; debt, interest income and impure income within thresholds). Shariah-screened; certification in progress.",
    dataRecency:
      "Screens are computed from the latest available public financials; recency varies by company. This is analysis, not a fatwa.",
    record: notRecorded("screens are not committed on-chain by design"),
  });
}
