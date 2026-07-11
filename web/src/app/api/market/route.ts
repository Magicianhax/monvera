// GET /api/market — real market history for charts and row sparklines.
//
//   ?symbol=AAPL&range=1M  -> { series, changePct, asOf } for the detail chart
//   (no params)            -> { summary: { [symbol]: { dayChangePct, spark } }, asOf }
//
// Sources: Yahoo Finance for the equities our xStocks track, CoinGecko for the
// token tier (see lib/server/marketData.ts). Cached server-side so a screenful
// of clients costs at most one upstream call per symbol per TTL window.
import type { NextRequest } from "next/server";
import { ALL_ASSETS } from "@/lib/tokens";
import {
  getHistory,
  getDaySummary,
  MARKET_RANGES,
  type MarketRange,
} from "@/lib/server/marketData";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public market data (shown pre-login), so no auth — rate-limited per IP.
  const limit = rateLimit(`market:${clientIp(req)}`, 240, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const symbol = req.nextUrl.searchParams.get("symbol");
  const range = req.nextUrl.searchParams.get("range") ?? "1M";

  try {
    // Summary mode — 1D change + spark for every asset (portfolio + market rows).
    if (!symbol) {
      const summary = await getDaySummary();
      return Response.json(
        { summary, asOf: new Date().toISOString() },
        { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
      );
    }

    if (!ALL_ASSETS.some((a) => a.symbol === symbol)) return badRequest("Unknown symbol.");
    if (!MARKET_RANGES.includes(range as MarketRange)) return badRequest("Unknown range.");

    const history = await getHistory(symbol, range as MarketRange);
    return Response.json(
      {
        series: history?.series ?? null,
        timestamps: history?.timestamps ?? null,
        changePct: history?.changePct ?? null,
        meta: history?.meta ?? null,
        asOf: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    return serverError("market", err);
  }
}
