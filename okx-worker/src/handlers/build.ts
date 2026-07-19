// Turns an EXTERNAL plan into per-leg swap instructions. Note: /v1/plan and
// /v1/basket already include their legs for free — this endpoint exists for
// plans that came from somewhere else (or were edited by the buyer).
// Non-custodial: Vera never signs; the buyer quotes and executes per leg.
import { z } from "zod";
import { json, errorJson, requestInput } from "../respond";
import { AllocationSchema } from "../allocation-schema";
import { SOL_MIN_LEG_USD } from "../legMath";
import { assetBySymbol } from "../universe";
import { buildLegs, OKX_SWAP_PARAMS } from "../legs";

const RequestSchema = z.object({
  plan: AllocationSchema,
  amountUsd: z.coerce.number().positive().max(1_000_000),
});

export async function handleBuild(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await requestInput(request));
  if (!parsed.success) {
    return errorJson(400, "Body must be { plan: Allocation, amountUsd: number }.");
  }
  const { plan, amountUsd } = parsed.data;

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
    execution: "sequential",
    rule: "quote -> approve -> execute per leg, in order",
    settlement: "Tokens land in the executing wallet. Vera never holds funds.",
    okxSwapParams: OKX_SWAP_PARAMS,
  });
}
