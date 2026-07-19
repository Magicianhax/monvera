// Paid: 1-year backtest of any weighted basket vs SPY.
import { z } from "zod";
import { json, errorJson, requestInput, DISCLAIMER, BACKTEST_DISCLAIMER } from "../respond";
import { backtestBasket } from "../quant";
import { assetBySymbol } from "../universe";
import { normalizeForRoute } from "../precheck";
import { notRecorded } from "../record";

const RequestSchema = z.object({
  allocations: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.coerce.number().positive().max(100) }))
    .min(1)
    .max(30),
});

export async function handleBacktest(request: Request): Promise<Response> {
  const input = normalizeForRoute("/v1/backtest", await requestInput(request));
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) {
    return errorJson(400, "Provide symbols+weights (CSV query params) or JSON { allocations: [{ symbol, weightPct }] } (1-30 legs).");
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
    record: notRecorded("backtests are not committed on-chain by design"),
    disclaimer: `${BACKTEST_DISCLAIMER} ${DISCLAIMER}`,
  });
}
