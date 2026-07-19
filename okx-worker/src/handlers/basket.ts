import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson } from "../respond";
import { BASKETS, resolveBasket, type BasketId } from "../baskets";
import { commitRecord } from "../record";
import { OKX_MIN_LEG_USD } from "../legMath";
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
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorJson(400, "Body must be { amountUsd: number, basket?: string }.");
  }
  const id = idFromPath || parsed.data.basket || "";
  if (!(id in BASKETS)) {
    return errorJson(404, `Unknown basket: ${id || "(none given)"}. Available: ${Object.keys(BASKETS).join(", ")}.`);
  }
  if (parsed.data.amountUsd < OKX_MIN_LEG_USD) {
    return errorJson(400, `Minimum amount is $${OKX_MIN_LEG_USD} (one leg above the venue floor).`);
  }
  const plan = await resolveBasket(id as BasketId, parsed.data.amountUsd);
  const record = await commitRecord(env, ctx, plan, payer, parsed.data.amountUsd).catch(() => undefined);
  return json({ basket: BASKETS[id as BasketId], plan, record, disclaimer: DISCLAIMER });
}
