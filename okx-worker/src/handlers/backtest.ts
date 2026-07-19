// Paid: 1-year backtest of any weighted basket vs SPY.
import { z } from "zod";
import { json, errorJson } from "../respond";
import { backtestBasket } from "../quant";
import { assetBySymbol } from "../universe";
import { DISCLAIMER } from "./plan";

const RequestSchema = z.object({
  allocations: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.number().positive().max(100) }))
    .min(1)
    .max(30),
});

export async function handleBacktest(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorJson(400, "Body must be { allocations: [{ symbol, weightPct }] } (1-30 legs).");
  }
  const unknown = parsed.data.allocations.filter((a) => assetBySymbol(a.symbol) === undefined);
  if (unknown.length > 0) {
    return errorJson(400, `Unknown symbols: ${unknown.map((a) => a.symbol).join(", ")}.`);
  }
  const result = await backtestBasket(
    parsed.data.allocations.map((a) => ({
      symbol: assetBySymbol(a.symbol)!.underlying,
      weightPct: a.weightPct,
    }))
  ).catch(() => null);
  if (!result) {
    return errorJson(502, "Backtest unavailable: too little public history for this mix, or the data source is down.");
  }
  return json({
    backtest: result,
    disclaimer: `Backtests are history, not promises. ${DISCLAIMER}`,
  });
}
