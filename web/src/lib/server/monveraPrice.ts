// $MONVERA spot price, server-side — read from the MONVERA/VIRTUAL pool (the
// only one with real depth; see lib/monveraToken.ts) via GeckoTerminal's pool
// API. Keyed through CoinGecko when COINGECKO_API_KEY is set, because the free
// GeckoTerminal host rate-limits per IP and Cloudflare Workers share egress
// IPs — from a Worker the unkeyed endpoint 429s almost every time (this is the
// same lesson the token chart learned). Cached ~60s per isolate and
// stale-served on failure, so a blip never breaks a caller: the portfolio just
// shows the last good value.
import { MONVERA_PAIR } from "@/lib/monveraToken";

const CG_URL = `https://api.coingecko.com/api/v3/onchain/networks/robinhood/pools/${MONVERA_PAIR}`;
const GT_URL = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${MONVERA_PAIR}`;

export interface MonveraSpot {
  priceUsd: number;
  change24h: number;
}

let cache: { at: number; spot: MonveraSpot } | null = null;

/** Cached $MONVERA spot (null only when it has never been fetchable). */
export async function getMonveraSpot(): Promise<MonveraSpot | null> {
  const now = Date.now();
  if (cache && now - cache.at < 60_000) return cache.spot;
  const key = process.env.COINGECKO_API_KEY;
  try {
    const res = await fetch(key ? CG_URL : GT_URL, {
      headers: {
        accept: "application/json",
        ...(key ? { "x-cg-demo-api-key": key } : {}),
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`${key ? "coingecko" : "geckoterminal"} ${res.status}`);
    const json = (await res.json()) as {
      data?: {
        attributes?: {
          base_token_price_usd?: string;
          price_change_percentage?: { h24?: string | number };
        };
      };
    };
    const attrs = json.data?.attributes;
    const priceUsd = Number(attrs?.base_token_price_usd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("pool: no usable price");
    cache = {
      at: now,
      spot: { priceUsd, change24h: Number(attrs?.price_change_percentage?.h24 ?? 0) || 0 },
    };
    return cache.spot;
  } catch {
    return cache?.spot ?? null; // stale beats missing; null only on cold failure
  }
}
