// $MONVERA spot price, server-side — DexScreener's main MONVERA/VIRTUAL pool
// (the only one with real depth; see lib/monveraToken.ts). Cached ~60s per
// isolate and stale-served on upstream failure, so a DexScreener blip never
// breaks a caller (the portfolio just shows the last good value).
import { MONVERA_PAIR } from "@/lib/monveraToken";

const PAIR_URL = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${MONVERA_PAIR}`;

export interface MonveraSpot {
  priceUsd: number;
  change24h: number;
}

let cache: { at: number; spot: MonveraSpot } | null = null;

/** Cached $MONVERA spot (null only when it has never been fetchable). */
export async function getMonveraSpot(): Promise<MonveraSpot | null> {
  const now = Date.now();
  if (cache && now - cache.at < 60_000) return cache.spot;
  try {
    const res = await fetch(PAIR_URL, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const json = (await res.json()) as {
      pair?: { priceUsd?: string; priceChange?: { h24?: number } } | null;
    };
    if (!json.pair?.priceUsd) throw new Error("dexscreener: no pair data");
    cache = {
      at: now,
      spot: { priceUsd: Number(json.pair.priceUsd), change24h: json.pair.priceChange?.h24 ?? 0 },
    };
    return cache.spot;
  } catch {
    return cache?.spot ?? null; // stale beats missing; null only on cold failure
  }
}
