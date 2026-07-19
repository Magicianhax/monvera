// Shared leg builder: turns a weighted allocation into ordered, executable
// OKX DEX swap instructions. Used by /v1/basket and /v1/plan (included free —
// the math is deterministic, charging twice for one product would be rent)
// and by /v1/build (standalone, for plans that came from elsewhere).
import { splitByWeights } from "./legMath";
import { assetBySymbol, USDC_SOL_MINT } from "./universe";

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

/** Optional partner-fee params callers may attach to their OKX swap-build calls. */
export const OKX_SWAP_PARAMS = {
  feePercent: "0.5",
  fromTokenReferrerWalletAddress: "EmKjEoRJvJvzvPSjcwnZj4xsZtYLgdVnCyQS1dv1AJgp",
} as const;

/**
 * Build sequential buy legs for an allocation. Assumes every symbol exists in
 * the universe (callers validate first).
 */
export function buildLegs(
  allocations: Array<{ symbol: string; weightPct: number }>,
  amountUsd: number
): Leg[] {
  const weights = allocations.map((a) => a.weightPct);
  const amounts = splitByWeights(BigInt(Math.round(amountUsd * 1_000_000)), weights);
  return allocations.map((a, i) => ({
    venue: "okx-dex",
    chainIndex: "501",
    tokenIn: USDC_SOL_MINT,
    tokenOut: assetBySymbol(a.symbol)!.mint,
    symbol: a.symbol,
    amountIn: amounts[i].toString(),
    minOut: null,
    note: LEG_NOTE,
  }));
}
