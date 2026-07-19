// Pre-payment request validation. x402 settles the fee BEFORE the merchant
// sees the request body, so a request that would 400 must be rejected here,
// before the payment gate — a buyer must never pay for a guaranteed failure.
// Mirrors each handler's schema (handlers still validate again; this is the
// no-charge guarantee, theirs is defense in depth).
import { z } from "zod";
import { AllocateRequestSchema } from "./allocation-schema";
import { assetBySymbol } from "./universe";
import { BASKETS } from "./baskets";

const research = z.object({ symbol: z.string().min(1).max(12) });
const halal = z.object({ symbols: z.array(z.string().min(1).max(12)).min(1).max(50) });
const basket = z.object({
  amountUsd: z.coerce.number().positive().max(1_000_000),
  basket: z.string().optional(),
});
const build = z.object({
  plan: z.object({ allocations: z.array(z.object({ symbol: z.string() })).min(1) }).passthrough(),
  amountUsd: z.coerce.number().positive().max(1_000_000),
});
const backtest = z.object({
  allocations: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.coerce.number().positive().max(100) }))
    .min(1)
    .max(30),
});
const compare = z.object({
  symbolA: z.string().min(1).max(12),
  symbolB: z.string().min(1).max(12),
  goal: z.string().max(300).optional(),
});
const rebalance = z.object({
  holdings: z
    .array(z.object({ symbol: z.string().min(1).max(12), usdValue: z.coerce.number().min(0) }))
    .max(50),
  target: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.coerce.number().min(0).max(100) }))
    .min(1)
    .max(30),
  cashUsd: z.coerce.number().min(0).optional(),
});

function unknownSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.filter((s) => assetBySymbol(s) === undefined))];
}

/**
 * Validate a paid request before charging. Returns an error message (→ 400,
 * no payment) or null (proceed to the payment gate).
 * `input` = query params merged under the JSON body.
 */
export function prevalidate(path: string, basketIdFromPath: string | null, input: Record<string, unknown>): string | null {
  if (path === "/v1/plan") {
    const r = AllocateRequestSchema.safeParse(input);
    return r.success ? null : "Provide { goal: string, amountUsd: number, riskTolerance?: string } (body or query).";
  }
  if (path === "/v1/research") {
    const r = research.safeParse(input);
    if (!r.success) return "Provide { symbol: string } (body or query).";
    return assetBySymbol(r.data.symbol) ? null : `Unknown symbol: ${r.data.symbol}. GET /v1/universe lists all names.`;
  }
  if (path === "/v1/halal-screen") {
    const r = halal.safeParse(input);
    return r.success ? null : "Provide { symbols: string[] } (1-50 tickers).";
  }
  if (path === "/v1/basket" || basketIdFromPath !== null) {
    const r = basket.safeParse(input);
    if (!r.success) return "Provide { amountUsd: number, basket?: string } (body or query).";
    const id = basketIdFromPath || r.data.basket || "";
    return id in BASKETS ? null : `Unknown basket: ${id || "(none given)"}. Available: ${Object.keys(BASKETS).join(", ")}.`;
  }
  if (path === "/v1/build") {
    const r = build.safeParse(input);
    if (!r.success) return "Provide { plan: Allocation, amountUsd: number }.";
    const bad = unknownSymbols(r.data.plan.allocations.map((a) => a.symbol));
    return bad.length === 0 ? null : `Unknown symbols in plan: ${bad.join(", ")}.`;
  }
  if (path === "/v1/backtest") {
    const r = backtest.safeParse(input);
    if (!r.success) return "Provide { allocations: [{ symbol, weightPct }] } (1-30 legs).";
    const bad = unknownSymbols(r.data.allocations.map((a) => a.symbol));
    return bad.length === 0 ? null : `Unknown symbols: ${bad.join(", ")}.`;
  }
  if (path === "/v1/compare") {
    const r = compare.safeParse(input);
    if (!r.success) return "Provide { symbolA: string, symbolB: string, goal?: string }.";
    const bad = unknownSymbols([r.data.symbolA, r.data.symbolB]);
    return bad.length === 0 ? null : `Unknown symbol: ${bad.join(", ")}.`;
  }
  if (path === "/v1/rebalance") {
    const r = rebalance.safeParse(input);
    if (!r.success) return "Provide { holdings: [{ symbol, usdValue }], target: [{ symbol, weightPct }], cashUsd?: number }.";
    const bad = unknownSymbols([...r.data.holdings.map((h) => h.symbol), ...r.data.target.map((t) => t.symbol)]);
    return bad.length === 0 ? null : `Unknown symbols: ${bad.join(", ")}.`;
  }
  return null; // screener and anything else without required input
}
