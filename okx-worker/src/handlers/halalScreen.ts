import { z } from "zod";
import { json, errorJson } from "../respond";
import { screenSymbols } from "../baskets";

const RequestSchema = z.object({ symbols: z.array(z.string().min(1).max(12)).min(1).max(50) });

export async function handleHalalScreen(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "Body must be { symbols: string[] } (1-50 tickers).");
  return json({
    results: screenSymbols(parsed.data.symbols),
    methodology:
      "AAOIFI sector and ratio screens (no banking, insurance, gambling, alcohol, weapons; debt, interest income and impure income within thresholds). Shariah-screened; certification in progress.",
  });
}
