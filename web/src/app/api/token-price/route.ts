// GET /api/token-price — live $MONVERA stats from the GeckoTerminal pool (main
// MONVERA/VIRTUAL v2 pool). Cached ~60s module-side and at the edge; on upstream
// failure the last good value is served stale so the Home pill never flashes 0.
// Public (pre-login pill on Home) but rate-limited per IP.
import type { NextRequest } from "next/server";
import { MONVERA_PAIR } from "@/lib/monveraToken";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

export const revalidate = 0;

// GeckoTerminal's pool API, keyed through CoinGecko when a key is set — the
// unkeyed host rate-limits per IP and Workers share egress IPs. Same source as
// the token chart and lib/server/monveraPrice, so every $MONVERA number the app
// shows comes from one place and they cannot disagree.
const CG_URL = `https://api.coingecko.com/api/v3/onchain/networks/robinhood/pools/${MONVERA_PAIR}`;
const GT_URL = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${MONVERA_PAIR}`;

interface TokenPrice {
  priceUsd: number;
  change24h: number;
  marketCap: number;
  liquidityUsd: number;
  volume24h: number;
  asOf: string;
}

let cache: { at: number; body: TokenPrice } | null = null;

export async function GET(req: NextRequest) {
  const limit = rateLimit(`token-price:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const now = Date.now();
  if (cache && now - cache.at < 60_000) {
    return Response.json(cache.body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  try {
    const key = process.env.COINGECKO_API_KEY;
    const res = await fetch(key ? CG_URL : GT_URL, {
      headers: { accept: "application/json", ...(key ? { "x-cg-demo-api-key": key } : {}) },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`${key ? "coingecko" : "geckoterminal"} ${res.status}`);
    const json = (await res.json()) as {
      data?: {
        attributes?: {
          base_token_price_usd?: string;
          price_change_percentage?: { h24?: string | number };
          market_cap_usd?: string | null;
          fdv_usd?: string | null;
          reserve_in_usd?: string | null;
          volume_usd?: { h24?: string | number };
        };
      };
    };
    const a = json.data?.attributes;
    const priceUsd = Number(a?.base_token_price_usd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("pool: no usable price");
    const body: TokenPrice = {
      priceUsd,
      change24h: Number(a?.price_change_percentage?.h24 ?? 0) || 0,
      // market_cap_usd is null for tokens without a circulating-supply source;
      // FDV is the honest stand-in rather than showing zero.
      marketCap: Number(a?.market_cap_usd ?? a?.fdv_usd ?? 0) || 0,
      liquidityUsd: Number(a?.reserve_in_usd ?? 0) || 0,
      volume24h: Number(a?.volume_usd?.h24 ?? 0) || 0,
      asOf: new Date().toISOString(),
    };
    cache = { at: now, body };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch (err) {
    // Serve the last good value stale rather than erroring the pill away.
    if (cache) {
      return Response.json(cache.body, {
        headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" },
      });
    }
    return serverError("token-price", err);
  }
}
