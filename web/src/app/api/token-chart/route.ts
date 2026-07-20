// GET /api/token-chart?range=5m|1h|4h|1d|7d — $MONVERA price history for the
// native PriceChart (same shape as /api/market: { series, changePct, asOf }).
// Source: GeckoTerminal OHLCV for the main MONVERA/VIRTUAL pool on Robinhood
// Chain (network slug "robinhood").
//
// Resilience: GeckoTerminal rate-limits by IP, and Cloudflare Workers egress
// from a shared pool of IPs, so the upstream intermittently 429s the Worker even
// though the same request succeeds from a browser. The in-memory Map cache does
// NOT survive a Worker cold start, so on its own a single 429 turned into a hard
// error on every range. We therefore persist each successful series to KV and
// serve the last-good series from KV whenever the upstream fails — a throttled
// request shows a slightly-stale chart instead of an error.
import type { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { MONVERA_PAIR } from "@/lib/monveraToken";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, badRequest, serverError } from "@/lib/server/respond";

export const revalidate = 0;

const POOL = MONVERA_PAIR;
const BASE = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${POOL}/ohlcv`;

// range → GeckoTerminal timeframe/aggregate + how many candles. Crypto-style
// intervals; the token is young, so longer ranges simply return fewer points
// (real data, never faked). GeckoTerminal aggregates: minute 1/5/15, hour 1/4/12,
// day 1. A fallback to plain hourly covers any timeframe that comes back empty.
const RANGES: Record<string, { tf: string; agg: number; limit: number }> = {
  "5m": { tf: "minute", agg: 5, limit: 288 }, // ~24h of 5-min candles
  "1h": { tf: "hour", agg: 1, limit: 168 }, // ~7d hourly
  "4h": { tf: "hour", agg: 4, limit: 180 }, // ~30d of 4h
  "1d": { tf: "hour", agg: 12, limit: 60 }, // ~30d in 12h candles (daily-ish)
  "7d": { tf: "hour", agg: 12, limit: 180 }, // longer 12h view
};

// CoinGecko's on-chain API serves the same pools with PER-KEY rate limits —
// the free GeckoTerminal endpoint throttles per IP, and Workers egress IPs are
// shared platform-wide, so from Cloudflare it 429s essentially always. Set
// COINGECKO_API_KEY (a free demo key works) and the route switches upstream.
const CG_BASE = `https://api.coingecko.com/api/v3/onchain/networks/robinhood/pools/${POOL}/ohlcv`;

async function ohlcv(tf: string, agg: number, limit: number): Promise<number[]> {
  const cgKey = process.env.COINGECKO_API_KEY;
  const url = cgKey ? `${CG_BASE}/${tf}?aggregate=${agg}&limit=${limit}` : `${BASE}/${tf}?aggregate=${agg}&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; MonveraBot/1.0; +https://monvera.best)",
      ...(cgKey ? { "x-cg-demo-api-key": cgKey } : {}),
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`${cgKey ? "coingecko" : "geckoterminal"} ${res.status}`);
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

// Per-isolate cache; short-lived. Backed by KV for cross-isolate / cold-start
// survival (see resilience note above).
const cache = new Map<string, { at: number; body: ChartBody }>();

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null;
  }
}

const kvKey = (range: string) => `token-chart:v1:${range}`;
// Keep last-good for a day so a throttled window still renders a chart.
const KV_TTL_S = 24 * 60 * 60;

async function readKv(range: string): Promise<ChartBody | null> {
  const store = kv();
  if (!store) return null;
  try {
    const raw = await store.get(kvKey(range));
    return raw ? (JSON.parse(raw) as ChartBody) : null;
  } catch {
    return null;
  }
}

async function writeKv(range: string, body: ChartBody): Promise<void> {
  const store = kv();
  if (!store) return;
  try {
    await store.put(kvKey(range), JSON.stringify(body), { expirationTtl: KV_TTL_S });
  } catch {
    /* best-effort */
  }
}

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

  // Fetch fresh; on ANY failure (empty, rate-limit, timeout) fall back to plain
  // hourly, then to the last-good series in KV, so the chart shows real data
  // instead of an error.
  let series: number[] = [];
  try {
    series = await ohlcv(cfg.tf, cfg.agg, cfg.limit);
  } catch (err) {
    console.error(`[token-chart] ${range} upstream failed:`, err instanceof Error ? err.message : err);
  }
  if (series.length === 0 && !(cfg.tf === "hour" && cfg.agg === 1)) {
    try {
      series = await ohlcv("hour", 1, 168);
    } catch (err) {
      console.error("[token-chart] hourly fallback failed:", err instanceof Error ? err.message : err);
    }
  }

  if (series.length > 0) {
    const changePct = series.length > 1 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 0;
    const body: ChartBody = { series, changePct, asOf: new Date().toISOString() };
    cache.set(range, { at: now, body });
    // Persist last-good so a future throttled window can serve stale.
    await writeKv(range, body);
    return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  }

  // Upstream unavailable — serve stale from KV (survives cold starts), else the
  // per-isolate cache, else a real error.
  const stale = (await readKv(range)) ?? hit?.body ?? null;
  if (stale) {
    return Response.json(stale, { headers: { "Cache-Control": "public, s-maxage=30" } });
  }
  return serverError("token-chart", new Error("geckoterminal: unavailable, no cached series"));
}
