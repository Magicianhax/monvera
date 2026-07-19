import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson, requestInput, DISCLAIMER, PREREQUISITES, BASE_URL } from "../respond";
import { BASKETS, resolveBasket, type BasketId } from "../baskets";
import { commitRecord, notRecorded } from "../record";
import { SOL_MIN_LEG_USD } from "../legMath";
import { buildLegs, referralDisclosure, EXECUTION_BLOCK, OKX_SWAP_PARAMS } from "../legs";
import { PRICES } from "../x402";

const RequestSchema = z.object({
  // coerce: A2MCP callers (e.g. the onchainos payment CLI) send params as strings
  amountUsd: z.coerce.number().min(1).max(1_000_000),
  basket: z.string().optional(),
});

export async function handleBasket(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idFromPath: string,
  payer: string
): Promise<Response> {
  const parsed = RequestSchema.safeParse(await requestInput(request));
  if (!parsed.success) {
    return errorJson(400, "Provide { amountUsd: number, basket?: string } (body or query).");
  }
  const id = idFromPath || parsed.data.basket || "";
  if (!(id in BASKETS)) {
    return errorJson(404, `Unknown basket: ${id || "(none given)"}. Available: ${Object.keys(BASKETS).join(", ")}.`);
  }
  if (parsed.data.amountUsd < SOL_MIN_LEG_USD) {
    return errorJson(400, `Minimum amount is $${SOL_MIN_LEG_USD}.`);
  }
  const plan = await resolveBasket(id as BasketId, parsed.data.amountUsd);
  const record = (await commitRecord(env, ctx, plan, payer, parsed.data.amountUsd).catch(() => undefined)) ??
    notRecorded("record contract not configured");

  // Synchronous plan storage: /v1/build?planId=... must work immediately.
  if (record.planId) {
    await env.KV.put(
      `plan:${record.planId}`,
      JSON.stringify({ v: 1, source: "basket", plan, payer, createdAt: Date.now() }),
      { expirationTtl: 30 * 24 * 60 * 60 }
    ).catch(() => undefined);
  }

  return json({
    basket: BASKETS[id as BasketId],
    plan,
    legs: buildLegs(plan.allocations, parsed.data.amountUsd),
    execution: EXECUTION_BLOCK,
    okxSwapParams: OKX_SWAP_PARAMS,
    costs: referralDisclosure(PRICES.basket),
    prerequisites: PREREQUISITES,
    record,
    next: record.planId
      ? [
          {
            what: "Re-size this basket into fresh legs without re-paying",
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
