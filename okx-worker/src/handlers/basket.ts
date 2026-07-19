import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson } from "../respond";
import { BASKETS, resolveBasket, type BasketId } from "../baskets";
import { commitRecord } from "../record";
import { OKX_MIN_LEG_USD } from "../legMath";
import { DISCLAIMER } from "./plan";

const RequestSchema = z.object({ amountUsd: z.number().positive().max(1_000_000) });

export async function handleBasket(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
  payer: string
): Promise<Response> {
  if (!(id in BASKETS)) {
    return errorJson(404, `Unknown basket: ${id}. Available: ${Object.keys(BASKETS).join(", ")}.`);
  }
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "Body must be { amountUsd: number }.");
  if (parsed.data.amountUsd < OKX_MIN_LEG_USD) {
    return errorJson(400, `Minimum amount is $${OKX_MIN_LEG_USD} (one leg above the venue floor).`);
  }
  const plan = await resolveBasket(id as BasketId, parsed.data.amountUsd);
  const record = await commitRecord(env, ctx, plan, payer, parsed.data.amountUsd).catch(() => undefined);
  return json({ basket: BASKETS[id as BasketId], plan, record, disclaimer: DISCLAIMER });
}
