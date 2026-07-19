import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson } from "../respond";
import { BASKETS, resolveBasket, type BasketId } from "../baskets";
import { commitRecord } from "../record";
import { SOL_MIN_LEG_USD } from "../legMath";
import { DISCLAIMER } from "./plan";

const RequestSchema = z.object({
  // coerce: A2MCP callers (e.g. the onchainos payment CLI) send params as strings
  amountUsd: z.coerce.number().positive().max(1_000_000),
  // Body-level basket id, used by the path-less "POST /v1/basket" form
  // (ASP listings need a concrete endpoint URL without path parameters).
  basket: z.string().optional(),
});

export async function handleBasket(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idFromPath: string,
  payer: string
): Promise<Response> {
  // A2MCP callers vary: params may arrive as JSON body or as query string.
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = RequestSchema.safeParse({ ...query, ...(body ?? {}) });
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
  const record = await commitRecord(env, ctx, plan, payer, parsed.data.amountUsd).catch(() => undefined);
  const { buildLegs, OKX_SWAP_PARAMS } = await import("../legs");
  return json({
    basket: BASKETS[id as BasketId],
    plan,
    // Executable legs included at no extra cost — one purchase, one product.
    legs: buildLegs(plan.allocations, parsed.data.amountUsd),
    execution: "sequential — quote, approve and execute each leg in order",
    okxSwapParams: OKX_SWAP_PARAMS,
    record,
    disclaimer: DISCLAIMER,
  });
}
