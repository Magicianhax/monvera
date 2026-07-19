import type { Env } from "../env";
import { json, errorJson, requestInput, DISCLAIMER, BACKTEST_DISCLAIMER, PREREQUISITES, BASE_URL } from "../respond";
import { AllocateRequestSchema } from "../allocation-schema";
import { buildAllocation } from "../engine";
import { backtestBasket } from "../quant";
import { assetBySymbol } from "../universe";
import { commitRecord, notRecorded } from "../record";
import { buildLegs, referralDisclosure, EXECUTION_BLOCK, OKX_SWAP_PARAMS } from "../legs";
import { PRICES } from "../x402";

export { DISCLAIMER };

export async function handlePlan(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  payer: string
): Promise<Response> {
  const parsed = AllocateRequestSchema.safeParse(await requestInput(request));
  if (!parsed.success) {
    return errorJson(400, parsed.error.issues[0]?.message ?? "invalid request body");
  }
  const plan = await buildAllocation(env, {
    goal: parsed.data.goal,
    amountUsd: parsed.data.amountUsd,
    riskTolerance: parsed.data.riskTolerance,
  });
  const backtest = await backtestBasket(
    plan.allocations.map((a) => ({
      symbol: assetBySymbol(a.symbol)?.underlying ?? a.symbol,
      weightPct: a.weightPct,
    }))
  ).catch(() => null);
  const record = (await commitRecord(env, ctx, plan, payer, parsed.data.amountUsd).catch(() => undefined)) ??
    notRecorded("record contract not configured");

  // Synchronous plan storage: /v1/build?planId=... must work in the same
  // request-cycle (waitUntil here would race the buyer's next call).
  if (record.planId) {
    await env.KV.put(
      `plan:${record.planId}`,
      JSON.stringify({ v: 1, source: "plan", plan, payer, createdAt: Date.now() }),
      { expirationTtl: 30 * 24 * 60 * 60 }
    ).catch(() => undefined);
  }

  return json({
    plan,
    backtest: backtest ? { ...backtest, disclaimer: BACKTEST_DISCLAIMER } : null,
    legs: buildLegs(plan.allocations, parsed.data.amountUsd),
    execution: EXECUTION_BLOCK,
    okxSwapParams: OKX_SWAP_PARAMS,
    costs: referralDisclosure(PRICES.plan),
    prerequisites: PREREQUISITES,
    record,
    next: record.planId
      ? [
          {
            what: "Re-size this plan into fresh legs without re-paying for the research",
            method: "POST",
            url: `${BASE_URL}/v1/build?planId=${record.planId}&amountUsd=<newUsd>`,
            priceUsd: PRICES.build,
            note: "If called within ~60 s of purchase, storage propagation may 404 briefly — retry per retryAfterSeconds.",
          },
        ]
      : [],
    disclaimer: DISCLAIMER,
  });
}
