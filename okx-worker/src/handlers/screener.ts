// Paid: momentum screener over the whole universe — deterministic, no AI cost.
import { json, errorJson, DISCLAIMER } from "../respond";
import { universeStatsRows } from "../quant";
import { UNIVERSE } from "../universe";
import { notRecorded } from "../record";

export async function handleScreener(): Promise<Response> {
  let rows;
  try {
    rows = await universeStatsRows(UNIVERSE.map((a) => a.underlying));
  } catch {
    return errorJson(502, "Market data is temporarily unavailable. Try again shortly.");
  }
  const bySymbol = new Map(UNIVERSE.map((a) => [a.underlying, a]));
  const ranked = rows
    .filter((r) => !r.noData && r.ret3mPct !== null && r.volPct !== null && r.volPct > 0)
    .map((r) => ({
      symbol: bySymbol.get(r.symbol)?.symbol ?? r.symbol,
      underlying: r.symbol,
      name: bySymbol.get(r.symbol)?.name ?? r.symbol,
      momentumScore: Math.round((r.ret3mPct! / r.volPct!) * 100) / 100,
      ret1yPct: r.ret1yPct,
      ret3mPct: r.ret3mPct,
      volPct: r.volPct,
      maxDrawdownPct: r.maxDrawdownPct,
    }))
    .sort((a, b) => b.momentumScore - a.momentumScore)
    .map((r, i) => ({ rank: i + 1, ...r }));
  const noData = rows.filter((r) => r.noData).map((r) => bySymbol.get(r.symbol)?.symbol ?? r.symbol);
  return json({
    asOf: new Date().toISOString(),
    metric: "3-month return divided by annualized volatility (trailing, real market data)",
    ranked,
    noData,
    record: notRecorded("screens are not committed on-chain by design"),
    disclaimer: DISCLAIMER,
  });
}
