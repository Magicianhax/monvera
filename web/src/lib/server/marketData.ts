// Server-only market history for Monvera assets — real charts + real daily moves.
//
//   - Stocks/ETFs (AAPL … SPY, QQQ): Yahoo Finance chart API. Our xStocks track
//     real equities and our tickers ARE the real tickers, so the underlying
//     market's history is the honest series to draw. The price you trade at is
//     still the on-chain pool spot (/api/prices) — the two track closely.
//   - sUSDe / mETH / FBTC / USDY: CoinGecko market charts (the underlying token).
//   - USDC / mUSD: flat $1 series, synthesized (they are dollar pegs).
//
// Everything is cached in-memory per instance (promise-deduped) so a screenful
// of clients costs at most one upstream call per symbol per TTL window.
import { ALL_ASSETS } from "@/lib/tokens";

export type MarketRange = "1D" | "1W" | "1M" | "1Y" | "All";
export const MARKET_RANGES: MarketRange[] = ["1D", "1W", "1M", "1Y", "All"];

/** Asset-level facts Yahoo returns in the chart meta (same call as the series). */
export interface MarketMeta {
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  dayHigh?: number;
  dayLow?: number;
  /** Latest regular-session volume (shares). */
  volume?: number;
  /** Listing venue, e.g. "NasdaqGS", "NYSEArca". */
  exchange?: string;
}

export interface MarketHistory {
  /** Closing prices, oldest -> newest (USD). */
  series: number[];
  /** Unix-seconds timestamp per close (aligned to `series`), when available. */
  timestamps?: number[];
  /** % change across the range (1D uses previous close where available). */
  changePct: number;
  /** Asset-level facts (only from the per-symbol chart call, not spark batch). */
  meta?: MarketMeta;
}

export interface DaySummaryEntry {
  dayChangePct: number;
  /** Downsampled 1D series for row sparklines. */
  spark: number[];
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

// ── source mapping ────────────────────────────────────────────────────────────
// Stocks AND ETFs — every registry ticker is the real Yahoo ticker.
const STOCK_SYMBOLS = new Set(ALL_ASSETS.map((s) => s.symbol));

// CoinGecko ids for any non-equity assets. Empty on Robinhood Chain — the whole
// universe is tokenized stocks + ETFs, priced via Yahoo (charts) + Chainlink (spot).
const COINGECKO_IDS: Record<string, string> = {};

// Flat dollar pegs — a real fetch would just draw the same line.
const FLAT_DOLLAR = new Set(["USDG"]);

// Tokenized PRIVATE companies whose ticker collides with (or resolves to) an
// unrelated public listing on Yahoo. Showing that series would be the wrong
// company — no chart is honest, a wrong chart is not. (Mirrors lib/server/quant.)
const WRONG_OR_PRIVATE = new Set(["SPCX", "CBRS", "XNDU", "P"]);

// ── Yahoo Finance (equities) ──────────────────────────────────────────────────
const YAHOO_RANGES: Record<MarketRange, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  All: { range: "max", interval: "1mo" },
};

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: {
        chartPreviousClose?: number;
        regularMarketPrice?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        fullExchangeName?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

// Yahoo throttles request bursts (and a 95-symbol universe IS a burst), so all
// chart calls share a small concurrency gate. Throttles/outages THROW instead
// of returning null — ttlCache drops failed loads, so a 429 is retried on the
// next request rather than poisoning the cache as "no data" for the whole TTL.
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

async function yahooHistory(ticker: string, range: MarketRange): Promise<MarketHistory | null> {
  const { range: r, interval } = YAHOO_RANGES[range];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${r}&interval=${interval}`;
  const res = await yahooSlot(() =>
    fetch(url, {
      headers: {
        // Yahoo rejects UA-less requests.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    }),
  );
  if (res.status === 404) return null; // genuinely unknown ticker — cacheable
  if (!res.ok) throw new Error(`yahoo ${res.status} for ${ticker}`); // throttle/outage — retryable
  return parseChart((await res.json()) as YahooChart, range);
}

function parseChart(json: YahooChart, range: MarketRange): MarketHistory | null {
  const result = json.chart?.result?.[0];
  // Zip closes with their timestamps so filtering out gaps keeps them aligned.
  const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
  const rawTs = result?.timestamp ?? [];
  const closes: number[] = [];
  const timestamps: number[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      closes.push(c);
      if (typeof rawTs[i] === "number") timestamps.push(rawTs[i]);
    }
  }
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  // 1D change is vs the previous session's close (the number brokers show),
  // not vs the first intraday tick.
  const m = result?.meta;
  const base = range === "1D" ? (m?.chartPreviousClose ?? closes[0]) : closes[0];
  const changePct = base > 0 ? ((last - base) / base) * 100 : 0;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const meta: MarketMeta = {
    fiftyTwoWeekHigh: num(m?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(m?.fiftyTwoWeekLow),
    dayHigh: num(m?.regularMarketDayHigh),
    dayLow: num(m?.regularMarketDayLow),
    volume: num(m?.regularMarketVolume),
    exchange: typeof m?.fullExchangeName === "string" ? m.fullExchangeName : undefined,
  };
  return {
    series: closes,
    timestamps: timestamps.length === closes.length ? timestamps : undefined,
    changePct,
    meta,
  };
}

// ── Yahoo spark (BATCH history — many symbols per request) ───────────────────
// The per-symbol chart API rate-limits a 95-symbol universe; spark returns the
// same daily closes for 20 symbols per call, so a full sweep is 5 requests.
interface SparkEntry {
  close?: Array<number | null>;
  chartPreviousClose?: number;
}

const SPARK_BATCH_SIZE = 20; // spark 400s above 20 symbols per request

async function yahooSparkBatch(
  tickers: string[],
  range: MarketRange,
): Promise<Map<string, MarketHistory>> {
  const { range: r, interval } = YAHOO_RANGES[range];
  const out = new Map<string, MarketHistory>();
  for (let i = 0; i < tickers.length; i += SPARK_BATCH_SIZE) {
    const batch = tickers.slice(i, i + SPARK_BATCH_SIZE);
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${batch.map(encodeURIComponent).join(",")}&range=${r}&interval=${interval}`;
    const res = await yahooSlot(() =>
      fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!res.ok) throw new Error(`yahoo spark ${res.status}`); // retryable — never cached
    const json = (await res.json()) as Record<string, SparkEntry>;
    for (const t of batch) {
      const entry = json[t];
      const closes = (entry?.close ?? []).filter(
        (c): c is number => typeof c === "number" && Number.isFinite(c),
      );
      if (closes.length < 2) continue;
      const last = closes[closes.length - 1];
      const base = range === "1D" ? (entry?.chartPreviousClose ?? closes[0]) : closes[0];
      out.set(t, { series: closes, changePct: base > 0 ? ((last - base) / base) * 100 : 0 });
    }
  }
  return out;
}

/**
 * Batched history for many symbols at once (spark API, ~25 per upstream call).
 * Cached as one unit per (symbol set, range). Symbols with no source (dollar
 * pegs, private/wrong tickers, unknowns) simply have no entry in the map.
 */
export function getManyHistories(
  symbols: string[],
  range: MarketRange,
): Promise<Map<string, MarketHistory>> {
  const yahooSyms = symbols.filter(
    (s) => STOCK_SYMBOLS.has(s) && !FLAT_DOLLAR.has(s) && !WRONG_OR_PRIVATE.has(s),
  );
  const key = `spark:${range}:${[...yahooSyms].sort().join(",")}`;
  return ttlCache(key, HISTORY_TTL[range], () => yahooSparkBatch(yahooSyms, range));
}

// ── CoinGecko (tokens) ────────────────────────────────────────────────────────
const COINGECKO_DAYS: Record<MarketRange, string> = {
  "1D": "1",
  "1W": "7",
  "1M": "30",
  "1Y": "365",
  All: "max",
};

async function coingeckoHistory(id: string, range: MarketRange): Promise<MarketHistory | null> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${COINGECKO_DAYS[range]}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { prices?: Array<[number, number]> };
  const series = (json.prices ?? [])
    .map((p) => p[1])
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (series.length < 2) return null;
  const changePct = series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 0;
  return { series, changePct };
}

// ── public surface ────────────────────────────────────────────────────────────
/** Evenly downsample a series to at most `n` points (keeps first + last). */
export function downsample(series: number[], n: number): number[] {
  if (series.length <= n) return series;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(series[Math.round((i * (series.length - 1)) / (n - 1))]);
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

/** Real price history for one asset, or null when no source exists / upstream fails. */
export function getHistory(symbol: string, range: MarketRange): Promise<MarketHistory | null> {
  return ttlCache(`history:${symbol}:${range}`, HISTORY_TTL[range], async () => {
    if (FLAT_DOLLAR.has(symbol)) return { series: Array(20).fill(1), changePct: 0 };
    if (WRONG_OR_PRIVATE.has(symbol)) return null;
    if (STOCK_SYMBOLS.has(symbol)) return yahooHistory(symbol, range);
    const cgId = COINGECKO_IDS[symbol];
    if (cgId) return coingeckoHistory(cgId, range);
    return null;
  });
}

/**
 * 1D change + row sparkline for every asset that has a live source. Powers the
 * portfolio rows and the market list. One cached object for all clients.
 */
export function getDaySummary(): Promise<Record<string, DaySummaryEntry>> {
  return ttlCache("day-summary", 5 * 60_000, async () => {
    const histories = await getManyHistories(
      ALL_ASSETS.map((a) => a.symbol),
      "1D",
    );
    const map: Record<string, DaySummaryEntry> = {};
    for (const [symbol, h] of histories) {
      map[symbol] = { dayChangePct: h.changePct, spark: downsample(h.series, 20) };
    }
    return map;
  });
}
