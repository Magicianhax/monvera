import type { Env } from "../env";
import { json, errorJson } from "../respond";
import { AllocateRequestSchema } from "../allocation-schema";
import { buildAllocation } from "../engine";
import { backtestBasket } from "../quant";
import { assetBySymbol } from "../universe";
import { commitRecord } from "../record";

export const DISCLAIMER =
  "Research output over tokenized xStocks. Not investment advice. Execute only through your own wallet.";

export async function handlePlan(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  payer: string
): Promise<Response> {
  const parsed = AllocateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorJson(400, parsed.error.issues[0]?.message ?? "invalid request body");
  }
  let plan;
  try {
    plan = await buildAllocation(env, {
      goal: parsed.data.goal,
      amountUsd: parsed.data.amountUsd,
      riskTolerance: parsed.data.riskTolerance,
    });
  } catch (err) {
    console.error("plan failed", err);
    return errorJson(502, err instanceof Error ? err.message : "allocation failed");
  }
  const backtest = await backtestBasket(
    plan.allocations.map((a) => ({
      symbol: assetBySymbol(a.symbol)?.underlying ?? a.symbol,
      weightPct: a.weightPct,
    }))
  ).catch(() => null);
  const record = await commitRecord(env, ctx, plan, payer, parsed.data.amountUsd).catch(() => undefined);
  return json({ plan, backtest, record, disclaimer: DISCLAIMER });
}
