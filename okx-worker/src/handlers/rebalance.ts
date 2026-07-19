// Paid: rebalance planner — current holdings + target plan → minimal diff legs.
// Non-custodial like everything else: we output instructions, the buyer's
// wallet quotes and executes each leg itself.
import { z } from "zod";
import { json, errorJson, requestInput } from "../respond";
import { SOL_MIN_LEG_USD } from "../legMath";
import { assetBySymbol, USDC_SOL_MINT } from "../universe";
import { DISCLAIMER } from "./plan";

const RequestSchema = z.object({
  holdings: z
    .array(z.object({ symbol: z.string().min(1).max(12), usdValue: z.number().min(0).max(10_000_000) }))
    .max(50),
  target: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.number().min(0).max(100) }))
    .min(1)
    .max(30),
  cashUsd: z.number().min(0).max(10_000_000).optional(),
});

const LEG_NOTE =
  "Quote this leg via the OKX DEX aggregator at execution time, get your user's approval, execute, then move to the next leg.";

export async function handleRebalance(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await requestInput(request));
  if (!parsed.success) {
    return errorJson(
      400,
      "Body must be { holdings: [{ symbol, usdValue }], target: [{ symbol, weightPct }], cashUsd?: number }."
    );
  }
  const { holdings, target, cashUsd = 0 } = parsed.data;

  const allSymbols = [...holdings.map((h) => h.symbol), ...target.map((t) => t.symbol)];
  const unknown = allSymbols.filter((s) => assetBySymbol(s) === undefined);
  if (unknown.length > 0) {
    return errorJson(400, `Unknown symbols: ${[...new Set(unknown)].join(", ")}.`);
  }
  const targetTotalPct = target.reduce((s, t) => s + t.weightPct, 0);
  if (Math.abs(targetTotalPct - 100) > 1) {
    return errorJson(400, `Target weights must sum to 100 (got ${Math.round(targetTotalPct)}).`);
  }

  const totalUsd = holdings.reduce((s, h) => s + h.usdValue, 0) + cashUsd;
  if (totalUsd < SOL_MIN_LEG_USD) {
    return errorJson(400, `Portfolio too small to rebalance (under $${SOL_MIN_LEG_USD}).`);
  }

  // Canonical per-symbol current + target dollars (keyed by xStock symbol).
  const current = new Map<string, number>();
  for (const h of holdings) {
    const sym = assetBySymbol(h.symbol)!.symbol;
    current.set(sym, (current.get(sym) ?? 0) + h.usdValue);
  }
  const targetUsd = new Map<string, number>();
  for (const t of target) {
    const sym = assetBySymbol(t.symbol)!.symbol;
    targetUsd.set(sym, (targetUsd.get(sym) ?? 0) + (t.weightPct / 100) * totalUsd);
  }

  const sells: Array<{ symbol: string; usd: number }> = [];
  const buys: Array<{ symbol: string; usd: number }> = [];
  for (const sym of new Set([...current.keys(), ...targetUsd.keys()])) {
    const diff = (targetUsd.get(sym) ?? 0) - (current.get(sym) ?? 0);
    if (diff >= SOL_MIN_LEG_USD) buys.push({ symbol: sym, usd: Math.round(diff * 100) / 100 });
    else if (-diff >= SOL_MIN_LEG_USD) sells.push({ symbol: sym, usd: Math.round(-diff * 100) / 100 });
    // |diff| below the venue floor → intentionally skipped (dust), reported below.
  }

  const skipped = [...new Set([...current.keys(), ...targetUsd.keys()])].filter((sym) => {
    const diff = Math.abs((targetUsd.get(sym) ?? 0) - (current.get(sym) ?? 0));
    return diff > 0.01 && diff < SOL_MIN_LEG_USD;
  });

  const legs = [
    // Sells first: they free the USDC that funds the buys.
    ...sells.map((s) => ({
      action: "sell" as const,
      venue: "okx-dex" as const,
      chainIndex: "501" as const,
      symbol: s.symbol,
      tokenIn: assetBySymbol(s.symbol)!.mint,
      tokenOut: USDC_SOL_MINT,
      approxUsd: s.usd,
      note: LEG_NOTE,
    })),
    ...buys.map((b) => ({
      action: "buy" as const,
      venue: "okx-dex" as const,
      chainIndex: "501" as const,
      symbol: b.symbol,
      tokenIn: USDC_SOL_MINT,
      tokenOut: assetBySymbol(b.symbol)!.mint,
      amountIn: String(Math.round(b.usd * 1_000_000)), // USDC 6dp
      approxUsd: b.usd,
      note: LEG_NOTE,
    })),
  ];

  return json({
    totalUsd: Math.round(totalUsd * 100) / 100,
    legs,
    skippedBelowMinimum: skipped,
    execution: "sequential — sells first, then buys",
    disclaimer: DISCLAIMER,
  });
}
