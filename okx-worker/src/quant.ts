// Quant layer — real-history backtesting for Vera's baskets.
// Ported from web/src/lib/server/quant.ts (server-only import dropped).
//
// Our underlyings ARE the real tickers, so each asset's honest backtest series
// is the underlying equity's daily closes (Yahoo via ./marketData, cached 6h
// per sweep). The engine simulates the proposed mix over the last 12 months
// with monthly rebalancing and reports it against buy-and-hold SPY.
//
// Honesty rules:
//   - Assets with no usable public history (tokenized private companies, thin
//     listings) are EXCLUDED and reported, never faked. Weights renormalize
//     over the covered subset and the response carries coveragePct.
//   - Past performance is context, not a promise — the UI must say so.
import { getManyHistories } from "./marketData";

// Tokenized names whose public ticker is NOT the same instrument (private
// companies / collides with an unrelated listing). Never backtest these.
export const NO_PUBLIC_HISTORY = new Set(["SPCX", "CBRS", "XNDU", "P"]);

const TRADING_DAYS_PER_YEAR = 252;
const REBALANCE_EVERY_BARS = 21; // ~monthly
const MIN_BARS = 60; // need at least ~3 months of dailies to say anything
const CURVE_POINTS = 60;

export interface BacktestSeries {
  /** Total return across the period, percent. */
  returnPct: number;
  /** Annualized daily volatility, percent. */
  volPct: number;
  /** Worst peak-to-trough drop across the period, percent (positive number). */
  maxDrawdownPct: number;
  /** Sharpe-style ratio (annualized mean daily return / annualized vol, rf=0). */
  sharpe: number;
  /** Equity curve normalized to start at 100, downsampled for the UI. */
  curve: number[];
}

export interface BacktestResult {
  period: "1Y";
  rebalance: "monthly";
  /** Share of the basket's weight that had real history to test (0-100). */
  coveragePct: number;
  /** Symbols left out because no honest public series exists. */
  excluded: string[];
  portfolio: BacktestSeries;
  benchmark: BacktestSeries & { symbol: "SPY" };
}

/** Return/vol/drawdown/Sharpe stats for a daily close (or equity) series. */
export function seriesStats(curve: number[]): Omit<BacktestSeries, "curve"> {
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) returns.push(curve[i] / curve[i - 1] - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  const annVol = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);

  let peak = curve[0];
  let maxDd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    maxDd = Math.max(maxDd, (peak - v) / peak);
  }

  return {
    returnPct: round2((curve[curve.length - 1] / curve[0] - 1) * 100),
    volPct: round2(annVol * 100),
    maxDrawdownPct: round2(maxDd * 100),
    sharpe: annVol > 0 ? round2((mean * TRADING_DAYS_PER_YEAR) / annVol) : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function downsample(series: number[], n: number): number[] {
  if (series.length <= n) return series.map(round2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(round2(series[Math.round((i * (series.length - 1)) / (n - 1))]));
  return out;
}

// ── per-asset stats for Vera's prompt ────────────────────────────────────────
// Real 12-month numbers per symbol so the model weights with data, not vibes.
// One warm pass covers the whole universe (Yahoo fetches are cached 6h in
// marketData); this compact string is cached too so an allocation pays at most
// one build per instance per window.

const STATS_TTL_MS = 6 * 60 * 60_000;
const QUARTER_BARS = 63; // ~3 trading months

/** Structured 12-month stats for one symbol. Numbers are null when the symbol
 *  has no usable public history (`noData`), so consumers can drop it honestly. */
export interface SymbolStat {
  symbol: string;
  /** Total return over the last ~12 months, percent. */
  ret1yPct: number | null;
  /** Return over the last ~3 months, percent (null if history is too short). */
  ret3mPct: number | null;
  /** Annualized daily volatility, percent. */
  volPct: number | null;
  /** Worst peak-to-trough drop over the period, percent (positive number). */
  maxDrawdownPct: number | null;
  /** True when no honest public series exists (tokenized private co / thin listing). */
  noData: boolean;
}

const NO_DATA: Omit<SymbolStat, "symbol"> = {
  ret1yPct: null,
  ret3mPct: null,
  volPct: null,
  maxDrawdownPct: null,
  noData: true,
};

// Keyed by symbol set — unlike the web app, this worker asks for different
// sets (full universe for plans, a single underlying for research notes).
const statsCache = new Map<string, { at: number; value: Promise<SymbolStat[]> }>();

async function buildStatsRows(symbols: string[]): Promise<SymbolStat[]> {
  // One batched sweep (3 upstream calls for the whole universe). A failed
  // sweep throws so the cache clears and the next caller retries.
  const histories = await getManyHistories(symbols, "1Y");
  return symbols.map((symbol) => {
    if (NO_PUBLIC_HISTORY.has(symbol)) return { symbol, ...NO_DATA };
    const h = histories.get(symbol);
    if (!h || h.series.length < MIN_BARS) return { symbol, ...NO_DATA };
    const s = h.series;
    const m = seriesStats(s);
    const ret3m =
      s.length > QUARTER_BARS
        ? round2((s[s.length - 1] / s[s.length - 1 - QUARTER_BARS] - 1) * 100)
        : null;
    return {
      symbol,
      ret1yPct: m.returnPct,
      ret3mPct: ret3m,
      volPct: m.volPct,
      maxDrawdownPct: m.maxDrawdownPct,
      noData: false,
    };
  });
}

/** Cached per-symbol stats — one warm build per instance per TTL window. Rejects
 *  (and clears the cache) on a failed sweep so the next caller retries. */
function statsRows(symbols: string[]): Promise<SymbolStat[]> {
  const key = [...symbols].sort().join(",");
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.value;
  const value = buildStatsRows(symbols).catch((err) => {
    statsCache.delete(key);
    throw err;
  });
  statsCache.set(key, { at: Date.now(), value });
  return value;
}

function promptLine(r: SymbolStat): string {
  if (r.noData) {
    return NO_PUBLIC_HISTORY.has(r.symbol)
      ? `${r.symbol}: no public data (tokenized private company)`
      : `${r.symbol}: no public data`;
  }
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
  return `${r.symbol}: 1y ${pct(r.ret1yPct!)}${r.ret3mPct !== null ? `, 3m ${pct(r.ret3mPct)}` : ""}, vol ${Math.round(r.volPct!)}%, worst dip -${Math.round(r.maxDrawdownPct!)}%`;
}

/**
 * Compact real-market stats for every symbol, one line each, for the
 * allocation system prompt. Cached; never throws (callers may still race a
 * cold cache, so they should treat failures as "no stats").
 */
export async function universeStatsBlock(symbols: string[]): Promise<string> {
  const rows = await statsRows(symbols);
  return rows.map(promptLine).join("\n");
}

/** The same cached computation, exposed as a structured array. Shares the cache. */
export function universeStatsRows(symbols: string[]): Promise<SymbolStat[]> {
  return statsRows(symbols);
}

/**
 * Backtest a weighted basket over the last 12 months of daily closes with
 * monthly rebalancing, vs buy-and-hold SPY. Returns null when too little of
 * the basket has usable history (below half the weight).
 */
export async function backtestBasket(
  allocations: { symbol: string; weightPct: number }[]
): Promise<BacktestResult | null> {
  const wanted = allocations.filter((a) => a.weightPct > 0);
  if (wanted.length === 0) return null;

  // One batched fetch for all legs + the benchmark.
  const histories = await getManyHistories([...wanted.map((a) => a.symbol), "SPY"], "1Y").catch(
    () => new Map<string, { series: number[] }>()
  );
  const usable = (symbol: string) => {
    if (NO_PUBLIC_HISTORY.has(symbol)) return null;
    const h = histories.get(symbol);
    return h && h.series.length >= MIN_BARS ? h.series : null;
  };

  const covered = wanted.filter((a) => usable(a.symbol));
  const excluded = wanted.filter((a) => !usable(a.symbol)).map((a) => a.symbol);
  const coveredWeight = covered.reduce((s, a) => s + a.weightPct, 0);
  const totalWeight = wanted.reduce((s, a) => s + a.weightPct, 0);
  const coveragePct = round2((coveredWeight / totalWeight) * 100);
  if (coveragePct < 50) return null; // a "backtest" of less than half the mix would mislead

  const spySeries = usable("SPY");
  if (!spySeries) return null;
  const spy = { series: spySeries };

  // Align everything to the shortest tail (bars are daily closes for all).
  const closes = covered.map((a) => usable(a.symbol) as number[]);
  const bars = Math.min(...closes.map((c) => c.length), spy.series.length);
  const tail = (c: number[]) => c.slice(c.length - bars);
  const aligned = closes.map(tail);
  const spyTail = tail(spy.series);

  // Simulate: start at 100, weights renormalized over the covered subset,
  // positions drift with prices and snap back to target every ~month.
  const weights = covered.map((a) => a.weightPct / coveredWeight);
  let positions = weights.map((w) => 100 * w); // dollar value per leg
  const curve: number[] = [100];
  for (let t = 1; t < bars; t++) {
    positions = positions.map((p, i) => p * (aligned[i][t] / aligned[i][t - 1]));
    const value = positions.reduce((s, p) => s + p, 0);
    curve.push(value);
    if (t % REBALANCE_EVERY_BARS === 0) positions = weights.map((w) => value * w);
  }

  const spyCurve = spyTail.map((v) => (v / spyTail[0]) * 100);

  return {
    period: "1Y",
    rebalance: "monthly",
    coveragePct,
    excluded,
    portfolio: { ...seriesStats(curve), curve: downsample(curve, CURVE_POINTS) },
    benchmark: { symbol: "SPY", ...seriesStats(spyCurve), curve: downsample(spyCurve, CURVE_POINTS) },
  };
}
