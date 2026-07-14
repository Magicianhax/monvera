// GET /api/token-price — live $MONVERA stats proxied from DexScreener (main
// MONVERA/VIRTUAL v2 pool). Cached ~60s module-side and at the edge; on upstream
// failure the last good value is served stale so the Home pill never flashes 0.
// Public (pre-login pill on Home) but rate-limited per IP.
import type { NextRequest } from "next/server";
import { MONVERA_PAIR } from "@/lib/monveraToken";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

export const revalidate = 0;

const PAIR_URL = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${MONVERA_PAIR}`;

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
    const res = await fetch(PAIR_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const json = (await res.json()) as {
      pair?: {
        priceUsd?: string;
        priceChange?: { h24?: number };
        marketCap?: number;
        liquidity?: { usd?: number };
        volume?: { h24?: number };
      } | null;
    };
    const p = json.pair;
    if (!p?.priceUsd) throw new Error("dexscreener: no pair data");
    const body: TokenPrice = {
      priceUsd: Number(p.priceUsd),
      change24h: p.priceChange?.h24 ?? 0,
      marketCap: p.marketCap ?? 0,
      liquidityUsd: p.liquidity?.usd ?? 0,
      volume24h: p.volume?.h24 ?? 0,
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
