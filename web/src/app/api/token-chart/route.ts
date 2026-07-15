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

// range → GeckoTerminal timeframe/aggregate + how many candles. Crypto-style
// intervals; the token is young, so longer ranges simply return fewer points
// (real data, never faked). GeckoTerminal aggregates: minute 1/5/15, hour 1/4/12,
// day 1.
// The pool is young: GeckoTerminal has no daily candles yet, so the longer
// ranges use 12-hour aggregates (which always have data). A fallback to hourly
// covers any timeframe that still comes back empty.
const RANGES: Record<string, { tf: string; agg: number; limit: number }> = {
  "5m": { tf: "minute", agg: 5, limit: 288 }, // ~24h of 5-min candles
  "1h": { tf: "hour", agg: 1, limit: 168 }, // ~7d hourly
  "4h": { tf: "hour", agg: 4, limit: 180 }, // ~30d of 4h
  "1d": { tf: "hour", agg: 12, limit: 60 }, // ~30d in 12h candles (daily-ish)
  "7d": { tf: "hour", agg: 12, limit: 180 }, // longer 12h view
};

async function ohlcv(tf: string, agg: number, limit: number): Promise<number[]> {
  const res = await fetch(`${BASE}/${tf}?aggregate=${agg}&limit=${limit}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  // ohlcv_list is [ts, open, high, low, close, volume], NEWEST first → reverse
  // to chronological and take the close of each candle.
  return (json.data?.attributes?.ohlcv_list ?? [])
    .slice()
    .reverse()
    .map((c) => Number(c[4]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

interface ChartBody {
  series: number[];
  changePct: number | null;
  asOf: string;
}

const cache = new Map<string, { at: number; body: ChartBody }>();

export async function GET(req: NextRequest) {
  const limit = rateLimit(`token-chart:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const range = req.nextUrl.searchParams.get("range") ?? "1h";
  const cfg = RANGES[range];
  if (!cfg) return badRequest("Unknown range.");

  const now = Date.now();
  const hit = cache.get(range);
  if (hit && now - hit.at < 120_000) {
    return Response.json(hit.body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  }

  try {
    // Try the requested timeframe; on ANY failure (empty, rate-limit, timeout)
    // fall back to plain hourly, which is the most reliably-available series, so
    // the chart shows real data instead of an error.
    let series: number[] = [];
    try {
      series = await ohlcv(cfg.tf, cfg.agg, cfg.limit);
    } catch {
      /* fall through to hourly */
    }
    if (series.length === 0 && !(cfg.tf === "hour" && cfg.agg === 1)) {
      try {
        series = await ohlcv("hour", 1, 168);
      } catch {
        /* fall through to stale/error */
      }
    }
    if (series.length === 0) {
      if (hit) return Response.json(hit.body, { headers: { "Cache-Control": "public, s-maxage=30" } });
      throw new Error("geckoterminal: empty ohlcv");
    }
    const changePct = series.length > 1 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 0;
    const body: ChartBody = { series, changePct, asOf: new Date().toISOString() };
    cache.set(range, { at: now, body });
    return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  } catch (err) {
    if (hit) return Response.json(hit.body, { headers: { "Cache-Control": "public, s-maxage=30" } });
    return serverError("token-chart", err);
  }
}
