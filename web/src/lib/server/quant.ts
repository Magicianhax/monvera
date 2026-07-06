import "server-only";

// Quant layer — real-history backtesting for Vera's baskets.
//
// Our tickers ARE the real tickers, so each asset's honest backtest series is
// the underlying equity's daily closes (Yahoo via lib/server/marketData, cached
// 6h per symbol). The engine simulates the proposed mix over the last 12 months
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

let statsCache: { at: number; value: Promise<string> } | null = null;

async function buildStatsBlock(symbols: string[]): Promise<string> {
  // One batched sweep (4 upstream calls for the whole universe). A failed
  // sweep throws so the cache clears and the next allocation retries.
  const histories = await getManyHistories(symbols, "1Y");
  const lines = symbols.map((symbol) => {
    if (NO_PUBLIC_HISTORY.has(symbol)) return `${symbol}: no public data (tokenized private company)`;
    const h = histories.get(symbol);
    if (!h || h.series.length < MIN_BARS) return `${symbol}: no public data`;
    const s = h.series;
    const m = seriesStats(s);
    const ret3m = s.length > QUARTER_BARS ? round2((s[s.length - 1] / s[s.length - 1 - QUARTER_BARS] - 1) * 100) : null;
    const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
    return `${symbol}: 1y ${pct(m.returnPct)}${ret3m !== null ? `, 3m ${pct(ret3m)}` : ""}, vol ${Math.round(m.volPct)}%, worst dip -${Math.round(m.maxDrawdownPct)}%`;
  });
  return lines.join("\n");
}

/**
 * Compact real-market stats for every symbol, one line each, for the
 * allocation system prompt. Cached; never throws (callers may still race a
 * cold cache, so they should treat failures as "no stats").
 */
export function universeStatsBlock(symbols: string[]): Promise<string> {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.value;
  const value = buildStatsBlock(symbols).catch((err) => {
    statsCache = null;
    throw err;
  });
  statsCache = { at: Date.now(), value };
  return value;
}

/**
 * Backtest a weighted basket over the last 12 months of daily closes with
 * monthly rebalancing, vs buy-and-hold SPY. Returns null when too little of
 * the basket has usable history (below half the weight).
 */
export async function backtestBasket(
  allocations: { symbol: string; weightPct: number }[],
): Promise<BacktestResult | null> {
  const wanted = allocations.filter((a) => a.weightPct > 0);
  if (wanted.length === 0) return null;

  // One batched fetch for all legs + the benchmark.
  const histories = await getManyHistories(
    [...wanted.map((a) => a.symbol), "SPY"],
    "1Y",
  ).catch(() => new Map<string, { series: number[] }>());
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
