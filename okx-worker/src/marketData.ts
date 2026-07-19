// Market history for the xStocks universe — ported from web/src/lib/server/marketData.ts.
// Our underlyings ARE the real Yahoo tickers, so the underlying market's history
// is the honest series. Only the spark batch path is ported (that's all the
// stats/backtest layer uses). Cached in-memory per isolate (promise-deduped).
import { UNIVERSE } from "./universe";

export type MarketRange = "1D" | "1W" | "1M" | "1Y" | "All";

export interface MarketHistory {
  /** Closing prices, oldest -> newest (USD). */
  series: number[];
  /** % change across the range (1D uses previous close where available). */
  changePct: number;
}

// ── tiny TTL cache (promise-deduped, per warm instance) ──────────────────────
const cacheStore = new Map<string, { at: number; value: Promise<unknown> }>();
function ttlCache<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cacheStore.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    cacheStore.delete(key); // don't cache failures for the whole TTL
    throw err;
  });
  cacheStore.set(key, { at: Date.now(), value });
  return value;
}

// Underlying tickers with a real Yahoo listing.
const STOCK_SYMBOLS = new Set(UNIVERSE.map((a) => a.underlying));

// Tokenized PRIVATE companies (or tickers colliding with unrelated listings) —
// showing that series would be the wrong company. Mirrors web quant layer.
export const WRONG_OR_PRIVATE = new Set(["SPCX", "CBRS", "XNDU", "P"]);

const YAHOO_RANGES: Record<MarketRange, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  All: { range: "max", interval: "1mo" },
};

// Yahoo throttles request bursts, so all calls share a small concurrency gate.
// Throttles/outages THROW instead of returning null — ttlCache drops failed
// loads, so a 429 is retried on the next request rather than poisoning the cache.
const MAX_CONCURRENT_YAHOO = 6;
let yahooInflight = 0;
const yahooWaiters: (() => void)[] = [];
async function yahooSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (yahooInflight >= MAX_CONCURRENT_YAHOO) {
    await new Promise<void>((resolve) => yahooWaiters.push(resolve));
  }
  yahooInflight++;
  try {
    return await fn();
  } finally {
    yahooInflight--;
    yahooWaiters.shift()?.();
  }
}

interface SparkEntry {
  close?: Array<number | null>;
  chartPreviousClose?: number;
}

const SPARK_BATCH_SIZE = 20; // spark 400s above 20 symbols per request

async function yahooSparkBatch(tickers: string[], range: MarketRange): Promise<Map<string, MarketHistory>> {
  const { range: r, interval } = YAHOO_RANGES[range];
  const out = new Map<string, MarketHistory>();
  for (let i = 0; i < tickers.length; i += SPARK_BATCH_SIZE) {
    const batch = tickers.slice(i, i + SPARK_BATCH_SIZE);
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${batch
      .map(encodeURIComponent)
      .join(",")}&range=${r}&interval=${interval}`;
    const res = await yahooSlot(() =>
      fetch(url, {
        headers: {
          // Yahoo rejects UA-less requests.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      })
    );
    if (!res.ok) throw new Error(`yahoo spark ${res.status}`); // retryable — never cached
    const json = (await res.json()) as Record<string, SparkEntry>;
    for (const t of batch) {
      const entry = json[t];
      const closes = (entry?.close ?? []).filter(
        (c): c is number => typeof c === "number" && Number.isFinite(c)
      );
      if (closes.length < 2) continue;
      const last = closes[closes.length - 1];
      const base = range === "1D" ? (entry?.chartPreviousClose ?? closes[0]) : closes[0];
      out.set(t, { series: closes, changePct: base > 0 ? ((last - base) / base) * 100 : 0 });
    }
  }
  return out;
}

// Intraday data moves; long ranges don't. Cache accordingly.
const HISTORY_TTL: Record<MarketRange, number> = {
  "1D": 3 * 60_000,
  "1W": 15 * 60_000,
  "1M": 60 * 60_000,
  "1Y": 6 * 60 * 60_000,
  All: 6 * 60 * 60_000,
};

/**
 * Batched history for many underlying tickers at once (spark API, 20 per
 * upstream call). Cached as one unit per (symbol set, range). Symbols with no
 * source (private companies, unknowns) simply have no entry in the map.
 */
export function getManyHistories(symbols: string[], range: MarketRange): Promise<Map<string, MarketHistory>> {
  const yahooSyms = symbols.filter((s) => STOCK_SYMBOLS.has(s) && !WRONG_OR_PRIVATE.has(s));
  const key = `spark:${range}:${[...yahooSyms].sort().join(",")}`;
  return ttlCache(key, HISTORY_TTL[range], () => yahooSparkBatch(yahooSyms, range));
}

/** Evenly downsample a series to at most `n` points (keeps first + last). */
export function downsample(series: number[], n: number): number[] {
  if (series.length <= n) return series;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(series[Math.round((i * (series.length - 1)) / (n - 1))]);
  }
  return out;
}
