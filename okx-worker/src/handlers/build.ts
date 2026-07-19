// Turns an EXTERNAL plan into per-leg swap instructions. /v1/plan and
// /v1/basket already include their legs free — this endpoint exists for plans
// that came from somewhere else, were edited, or need re-sizing.
//
// Three input forms (prevalidate guarantees exactly one is usable pre-payment):
//   1. planId  — a purchased plan/basket id or a free /v1/build/stage id (KV)
//   2. symbols+weights CSV — pure query-string scalars
//   3. nested JSON body { plan, amountUsd }
import { z } from "zod";
import type { Env } from "../env";
import { json, errorJson, requestInput, DISCLAIMER, PREREQUISITES } from "../respond";
import { AllocationSchema, type Allocation } from "../allocation-schema";
import { SOL_MIN_LEG_USD } from "../legMath";
import { assetBySymbol } from "../universe";
import { buildLegs, referralDisclosure, EXECUTION_BLOCK, OKX_SWAP_PARAMS } from "../legs";
import { notRecorded } from "../record";
import { normalizeForRoute } from "../precheck";
import { PRICES } from "../x402";

const RequestSchema = z.object({
  amountUsd: z.coerce.number().min(1).max(1_000_000),
  planId: z.string().optional(),
  plan: AllocationSchema.optional(),
});

export async function handleBuild(request: Request, env: Env): Promise<Response> {
  const input = normalizeForRoute("/v1/build", await requestInput(request));
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) {
    return errorJson(400, "Provide amountUsd plus ONE OF: planId, symbols+weights (CSV), or a JSON body {plan}.");
  }
  let plan: Allocation | undefined = parsed.data.plan;
  if (!plan && parsed.data.planId) {
    const stored = (await env.KV.get(`plan:${parsed.data.planId}`, "json").catch(() => null)) as
      | { plan?: Allocation }
      | null;
    plan = stored?.plan;
  }
  if (!plan) {
    return errorJson(404, `planId unknown or expired: ${parsed.data.planId ?? "(none)"}.`, {
      code: "PLAN_NOT_FOUND",
      retryAfterSeconds: 60,
    });
  }

  const { amountUsd } = parsed.data;
  const unknown = plan.allocations.filter((a) => assetBySymbol(a.symbol) === undefined);
  if (unknown.length > 0) {
    // Never silently drop legs — a dropped leg means the user's money lands short.
    return errorJson(400, `Unknown symbols in plan: ${unknown.map((a) => a.symbol).join(", ")}.`);
  }

  const legs = buildLegs(plan.allocations, amountUsd);
  const dust = legs.filter((l) => BigInt(l.amountIn) < BigInt(SOL_MIN_LEG_USD * 1_000_000));
  if (dust.length > 0) {
    return errorJson(
      400,
      `Legs below the $${SOL_MIN_LEG_USD} dust floor: ${dust.map((l) => l.symbol).join(", ")}. Increase amountUsd or trim the plan.`
    );
  }

  return json({
    legs,
    execution: EXECUTION_BLOCK,
    settlement: "Tokens land in the executing wallet. Vera never holds funds.",
    okxSwapParams: OKX_SWAP_PARAMS,
    costs: referralDisclosure(PRICES.build),
    prerequisites: PREREQUISITES,
    record: notRecorded("only /v1/plan and /v1/basket purchases are committed on-chain"),
    disclaimer: DISCLAIMER,
  });
}
