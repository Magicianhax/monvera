// GET /api/token-chart?range=1D|1W|1M|1Y|All — $MONVERA price history for the
// native PriceChart (same shape as /api/market: { series, changePct, asOf }).
// Source: GeckoTerminal OHLCV for the main MONVERA/VIRTUAL pool on Robinhood
// Chain (network slug "robinhood"). Cached per range so a burst of viewers
// doesn't hammer the upstream; stale-served on failure.
import type { NextRequest } from "next/server";
import { MONVERA_PAIR } from "@/lib/monveraToken";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, badRequest, serverError } from "@/lib/server/respond";

export const revalidate = 0;

const POOL = MONVERA_PAIR;
const BASE = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${POOL}/ohlcv`;

// range → GeckoTerminal timeframe + how many candles. The token is young, so
// longer ranges simply return fewer points (real data, never faked).
const RANGES: Record<string, { tf: string; limit: number }> = {
  "1D": { tf: "hour", limit: 24 },
  "1W": { tf: "hour", limit: 168 },
  "1M": { tf: "day", limit: 30 },
  "1Y": { tf: "day", limit: 365 },
  All: { tf: "day", limit: 1000 },
};

interface ChartBody {
  series: number[];
  changePct: number | null;
  asOf: string;
}

const cache = new Map<string, { at: number; body: ChartBody }>();

export async function GET(req: NextRequest) {
  const limit = rateLimit(`token-chart:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const range = req.nextUrl.searchParams.get("range") ?? "1D";
  const cfg = RANGES[range];
  if (!cfg) return badRequest("Unknown range.");

  const now = Date.now();
  const hit = cache.get(range);
  if (hit && now - hit.at < 120_000) {
    return Response.json(hit.body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  }

  try {
    const res = await fetch(`${BASE}/${cfg.tf}?aggregate=1&limit=${cfg.limit}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
    const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    // ohlcv_list is [ts, open, high, low, close, volume], NEWEST first → reverse
    // to chronological and take the close of each candle.
    const list = json.data?.attributes?.ohlcv_list ?? [];
    const series = list
      .slice()
      .reverse()
      .map((c) => Number(c[4]))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (series.length === 0) throw new Error("geckoterminal: empty ohlcv");
    const changePct = series.length > 1 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 0;
    const body: ChartBody = { series, changePct, asOf: new Date().toISOString() };
    cache.set(range, { at: now, body });
    return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  } catch (err) {
    if (hit) return Response.json(hit.body, { headers: { "Cache-Control": "public, s-maxage=30" } });
    return serverError("token-chart", err);
  }
}
