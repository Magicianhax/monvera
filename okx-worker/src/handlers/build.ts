// Turns a plan into per-leg swap instructions the buyer's own wallet executes.
// Non-custodial: Vera never signs. The buyer must quote each leg at execution
// time and execute it before quoting the next (per-leg rule; upfront quotes go
// stale and tail legs die).
import { z } from "zod";
import { json, errorJson } from "../respond";
import { AllocationSchema } from "../allocation-schema";
import { splitByWeights, OKX_MIN_LEG_USD } from "../legMath";
import { assetBySymbol, USDC_SOL_MINT } from "../universe";

const RequestSchema = z.object({
  plan: AllocationSchema,
  amountUsd: z.number().positive().max(1_000_000),
});

export interface Leg {
  venue: "okx-dex";
  chainIndex: "501";
  tokenIn: string;
  tokenOut: string;
  symbol: string;
  amountIn: string; // USDC base units (6dp)
  minOut: null;
  note: string;
}

const LEG_NOTE =
  "Quote this leg via the OKX DEX aggregator at execution time, get your user's approval, execute, then move to the next leg. Never quote all legs upfront.";

export async function handleBuild(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorJson(400, "Body must be { plan: Allocation, amountUsd: number }.");
  }
  const { plan, amountUsd } = parsed.data;

  const unknown = plan.allocations.filter((a) => assetBySymbol(a.symbol) === undefined);
  if (unknown.length > 0) {
    // Never silently drop legs — a dropped leg means the user's money lands short.
    return errorJson(400, `Unknown symbols in plan: ${unknown.map((a) => a.symbol).join(", ")}.`);
  }

  const weights = plan.allocations.map((a) => a.weightPct);
  const amounts = splitByWeights(BigInt(Math.round(amountUsd * 1_000_000)), weights);
  const legs: Leg[] = plan.allocations.map((a, i) => ({
    venue: "okx-dex",
    chainIndex: "501",
    tokenIn: USDC_SOL_MINT,
    tokenOut: assetBySymbol(a.symbol)!.mint,
    symbol: a.symbol,
    amountIn: amounts[i].toString(),
    minOut: null,
    note: LEG_NOTE,
  }));

  const dust = legs.filter((l) => BigInt(l.amountIn) < BigInt(OKX_MIN_LEG_USD * 1_000_000));
  if (dust.length > 0) {
    return errorJson(
      400,
      `Legs below the $${OKX_MIN_LEG_USD} venue minimum: ${dust.map((l) => l.symbol).join(", ")}. Increase amountUsd or trim the plan.`
    );
  }

  return json({
    legs,
    execution: "sequential",
    rule: "quote -> approve -> execute per leg, in order",
    settlement: "Tokens land in the executing wallet. Vera never holds funds.",
  });
}
