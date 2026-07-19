// Shared leg builder: turns a weighted allocation into ordered, executable
// OKX-DEX swap instructions. Used by /v1/basket and /v1/plan (legs included
// free — the math is deterministic) and by /v1/build (external plans).
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
  suggestedSlippagePercent: string;
  note: string;
}

export const SUGGESTED_SLIPPAGE_PERCENT = "1";

const LEG_NOTE =
  "Quote this leg via the OKX DEX aggregator at execution time (v6; the slippage param is slippagePercent, NOT slippage), get your user's approval, execute, then move to the next leg — never quote all legs upfront. Solana tx bytes come back BASE58-encoded; xStocks are Token-2022 tokens. minOut is null by design (quotes expire ~5 min; set slippagePercent yourself — executing without it exposes you to sandwich MEV). Legs are independent fixed-amount buys: a failure mid-sequence leaves earlier legs correctly filled; resume by re-quoting ONLY the remaining legs.";

/** The honest cost block every legs-bearing response carries. */
export function costsBlock(apiFeeUsd: number): Record<string, unknown> {
  return {
    apiFeeUsd,
    executionReferralFee: {
      percent: "0",
      history:
        "A 0.5% execution referral fee existed from launch, undisclosed. It was disclosed on 2026-07-20 and REMOVED entirely the same day. The per-call fee is the only fee Vera charges. If you ever see referral params in a response, do not execute — cross-check GET / pricing.changelog.",
    },
    slippageCostNote: `The suggested ${SUGGESTED_SLIPPAGE_PERCENT}% per-leg slippage tolerance is a cost cap you set, not a fee we charge.`,
    worstCaseAllInNote:
      "All-in worked examples (per-call fee + full slippage tolerance) are published at GET / under costs.feeSchedule.",
  };
}

/** Execution metadata block for legs-bearing responses. */
export const EXECUTION_BLOCK = {
  mode: "sequential — quote, approve and execute each leg in order",
  slippage: `set slippagePercent=${SUGGESTED_SLIPPAGE_PERCENT} (or your own tolerance) on every OKX swap-build; minOut is null by design`,
  txEncoding: "base58 (OKX v6 Solana swap-builds return BASE58 tx bytes)",
  tokenProgram: "xStocks are Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)",
  legFailureResume:
    "Legs are independent fixed-amount buys. Stop is safe at any point; resume by re-quoting only the remaining legs — never re-execute a filled leg.",
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
    suggestedSlippagePercent: SUGGESTED_SLIPPAGE_PERCENT,
    note: LEG_NOTE,
  }));
}
