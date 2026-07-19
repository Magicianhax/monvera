// Momentum ranking for the dynamic basket. Separate from quant.ts so the
// static baskets don't pull the stats sweep into their import path.
import { universeStatsRows } from "./quant";
import { assetBySymbol } from "./universe";

const SAFE_FALLBACK = ["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META"];

/**
 * Top `topN` underlyings by trailing risk-adjusted momentum (3-month return
 * over annualized volatility, breaking ties on 1-year return). Falls back to
 * a fixed mega-cap list when the stats sweep is unavailable.
 */
export async function momentumRank(underlyings: string[], topN: number): Promise<string[]> {
  try {
    const rows = await universeStatsRows(underlyings);
    const scored = rows
      .filter((r) => !r.noData && r.ret3mPct !== null && r.volPct !== null && r.volPct > 0)
      .map((r) => ({
        symbol: r.symbol,
        score: r.ret3mPct! / r.volPct!,
        ret1y: r.ret1yPct ?? 0,
      }))
      .sort((a, b) => (b.score === a.score ? b.ret1y - a.ret1y : b.score - a.score));
    const top = scored.slice(0, topN).map((r) => r.symbol);
    if (top.length >= Math.min(3, topN)) return top;
    throw new Error("too few scored symbols");
  } catch {
    return SAFE_FALLBACK.filter((t) => assetBySymbol(t) !== undefined).slice(0, topN);
  }
}
