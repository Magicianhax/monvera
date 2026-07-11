import "server-only";

// Monvera's own strategies — deterministic, rule-based portfolios computed
// from real 12-month market data. No AI in the loop: the same data always
// produces the same weights, so anyone can reproduce them from the published
// method (that's the point — they're public at /strategies + /api/strategies).
//
// Each strategy is rebuilt from fresh stats every 6h (the market-data TTL) and
// backtested by the same engine that checks Vera's plans (lib/server/quant).
import { STOCKS, ETFS } from "@/lib/tokens";
import { getManyHistories } from "./marketData";
import { seriesStats, NO_PUBLIC_HISTORY, type BacktestSeries } from "./quant";

const MIN_BARS = 60;
const QUARTER_BARS = 63; // ~3 trading months
const REBALANCE_EVERY_BARS = 21;
const CURVE_POINTS = 60;

// Exported pieces below (AssetStat, inverseVolWeights, walkForward,
// buildUniverseData) are the shared strategy engine — the /themes book
// (lib/server/themes.ts) runs the same math over theme universes.
export interface AssetStat {
  symbol: string;
  ret1y: number;
  ret3m: number;
  vol: number;
  maxDd: number;
}

export interface StrategyAllocation {
  symbol: string;
  weightPct: number;
}

/**
 * Walk-forward backtest: at every monthly rebalance the rule is re-run using
 * ONLY the data available at that moment, then held out-of-sample until the
 * next rebalance. No look-ahead — a rule that just picks last year's winners
 * gets no credit for having seen the answer sheet.
 */
export interface StrategyBacktest {
  period: "6M";
  methodology: "walk-forward";
  rebalance: "monthly";
  portfolio: BacktestSeries;
  benchmark: BacktestSeries & { symbol: "SPY" };
}

export interface PublicStrategy {
  id: string;
  name: string;
  tagline: string;
  /** The full rule, in plain words — enough to reproduce the weights. */
  method: string;
  allocations: StrategyAllocation[];
  backtest: StrategyBacktest | null;
}

export interface StrategiesPayload {
  asOf: string;
  refreshedEvery: string;
  note: string;
  strategies: PublicStrategy[];
}

// ── weight math ───────────────────────────────────────────────────────────────

/** Inverse-volatility weights with a per-asset cap; excess redistributes. */
export function inverseVolWeights(assets: AssetStat[], capPct: number): StrategyAllocation[] {
  let free = assets.map((a) => ({ symbol: a.symbol, raw: 1 / Math.max(a.vol, 1) }));
  const fixed: StrategyAllocation[] = [];
  let budget = 100;
  // Iteratively pin anything that breaches the cap and renormalize the rest.
  for (let guard = 0; guard < assets.length; guard++) {
    const rawSum = free.reduce((s, a) => s + a.raw, 0);
    const over = free.filter((a) => (a.raw / rawSum) * budget > capPct);
    if (over.length === 0) break;
    for (const o of over) fixed.push({ symbol: o.symbol, weightPct: capPct });
    budget -= over.length * capPct;
    free = free.filter((a) => !over.some((o) => o.symbol === a.symbol));
  }
  const rawSum = free.reduce((s, a) => s + a.raw, 0);
  const out = [
    ...fixed,
    ...free.map((a) => ({ symbol: a.symbol, weightPct: (a.raw / rawSum) * budget })),
  ];
  return roundTo100(out);
}

/** Round weights to integers that sum to exactly 100 (largest remainder). */
function roundTo100(allocs: StrategyAllocation[]): StrategyAllocation[] {
  const floored = allocs.map((a) => ({ ...a, floor: Math.floor(a.weightPct) }));
  let left = 100 - floored.reduce((s, a) => s + a.floor, 0);
  const byRemainder = [...floored].sort(
    (a, b) => (b.weightPct - b.floor) - (a.weightPct - a.floor),
  );
  const bump = new Set<string>();
  for (const a of byRemainder) {
    if (left <= 0) break;
    bump.add(a.symbol);
    left--;
  }
  return floored
    .map((a) => ({ symbol: a.symbol, weightPct: a.floor + (bump.has(a.symbol) ? 1 : 0) }))
    .filter((a) => a.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct);
}

/** Blend two weight sets at the given split (e.g. 55% core + 45% growth). */
function blend(a: StrategyAllocation[], aPct: number, b: StrategyAllocation[]): StrategyAllocation[] {
  const merged = new Map<string, number>();
  for (const x of a) merged.set(x.symbol, (merged.get(x.symbol) ?? 0) + (x.weightPct * aPct) / 100);
  for (const x of b) merged.set(x.symbol, (merged.get(x.symbol) ?? 0) + (x.weightPct * (100 - aPct)) / 100);
  return roundTo100([...merged].map(([symbol, weightPct]) => ({ symbol, weightPct })));
}

// ── strategy rules ────────────────────────────────────────────────────────────

function steadyFoundation(etfs: AssetStat[]): StrategyAllocation[] {
  // All ETFs with data, weighted by inverse volatility, 30% cap so the
  // near-zero-vol treasury fund can't swallow the whole book.
  return inverseVolWeights(etfs, 30);
}

function momentumLeaders(stocks: AssetStat[]): StrategyAllocation[] {
  // Both trends must be positive (the 3-month confirms the year), rank by a
  // blended momentum score, take the top 8, size by inverse vol, 20% cap.
  const trending = stocks.filter((a) => a.ret1y > 0 && a.ret3m > 0);
  const scored = trending
    .map((a) => ({ ...a, score: 0.7 * a.ret1y + 0.3 * a.ret3m * 4 })) // 3m annualized-ish
    .sort((x, y) => y.score - x.score)
    .slice(0, 8);
  return inverseVolWeights(scored, 20);
}

function balancedGrowth(etfs: AssetStat[], stocks: AssetStat[]): StrategyAllocation[] {
  // 55% broad-market core (inverse-vol over SPY/QQQ-style index funds only,
  // treasuries excluded — the core should be the MARKET, not cash) blended
  // with 45% of the Momentum Leaders stock sleeve.
  const core = etfs.filter((a) => !["SGOV"].includes(a.symbol));
  return blend(inverseVolWeights(core, 40), 55, momentumLeaders(stocks));
}

// ── walk-forward engine ───────────────────────────────────────────────────────

export type Rule = (etfs: AssetStat[], stocks: AssetStat[]) => StrategyAllocation[];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function downsample(series: number[], n: number): number[] {
  if (series.length <= n) return series.map(round2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(round2(series[Math.round((i * (series.length - 1)) / (n - 1))]));
  return out;
}

/** Stats a rule is allowed to see at bar `t` — closes strictly BEFORE t. */
function statsAt(tails: Map<string, number[]>, t: number): AssetStat[] {
  const out: AssetStat[] = [];
  for (const [symbol, full] of tails) {
    const s = full.slice(0, t);
    if (s.length < MIN_BARS + QUARTER_BARS) continue;
    const window = s.slice(-Math.min(252, s.length)); // "1y" = up to a year of what exists
    const m = seriesStats(window);
    out.push({
      symbol,
      ret1y: m.returnPct,
      ret3m: (s[s.length - 1] / s[s.length - 1 - QUARTER_BARS] - 1) * 100,
      vol: m.volPct,
      maxDd: m.maxDrawdownPct,
    });
  }
  return out;
}

export function walkForward(
  rule: Rule,
  tails: Map<string, number[]>,
  etfSyms: Set<string>,
): StrategyBacktest | null {
  const bars = Math.min(...[...tails.values()].map((s) => s.length));
  if (!Number.isFinite(bars) || bars < 200) return null;
  const spy = tails.get("SPY");
  if (!spy) return null;

  const start = Math.floor(bars / 2); // ~6 months formation, ~6 months test
  let positions = new Map<string, number>();
  const curve: number[] = [100];
  for (let t = start; t < bars; t++) {
    if ((t - start) % REBALANCE_EVERY_BARS === 0) {
      const st = statsAt(tails, t);
      const weights = rule(
        st.filter((a) => etfSyms.has(a.symbol)),
        st.filter((a) => !etfSyms.has(a.symbol)),
      );
      if (weights.length > 0) {
        const value = curve[curve.length - 1];
        positions = new Map(weights.map((w) => [w.symbol, (value * w.weightPct) / 100]));
      } // an empty pick keeps the previous book (or stays in cash at the start)
    }
    let value = 0;
    for (const [symbol, p] of positions) {
      const s = tails.get(symbol) as number[];
      const next = p * (s[t] / s[t - 1]);
      positions.set(symbol, next);
      value += next;
    }
    curve.push(positions.size > 0 ? value : curve[curve.length - 1]);
  }

  const spyWindow = spy.slice(start - 1);
  const spyCurve = spyWindow.map((v) => (v / spyWindow[0]) * 100);

  return {
    period: "6M",
    methodology: "walk-forward",
    rebalance: "monthly",
    portfolio: { ...seriesStats(curve), curve: downsample(curve, CURVE_POINTS) },
    benchmark: { symbol: "SPY", ...seriesStats(spyCurve), curve: downsample(spyCurve, CURVE_POINTS) },
  };
}

// ── public payload ────────────────────────────────────────────────────────────

const PAYLOAD_TTL_MS = 6 * 60 * 60_000;
let payloadCache: { at: number; value: Promise<StrategiesPayload> } | null = null;

/**
 * Fetch 1Y histories for `symbols` and derive the stats + aligned series the
 * engine needs. Symbols with no public history or a short tape are dropped
 * (and reported in `skipped`) — the honesty rule: name exclusions, never
 * synthesize them.
 */
export async function buildUniverseData(symbols: string[]): Promise<{
  stats: AssetStat[];
  tails: Map<string, number[]>;
  skipped: string[];
}> {
  const eligible = symbols.filter((s) => !NO_PUBLIC_HISTORY.has(s));
  const histories = await getManyHistories(eligible, "1Y");

  const stats: AssetStat[] = [];
  for (const symbol of eligible) {
    const h = histories.get(symbol);
    if (!h || h.series.length < MIN_BARS + QUARTER_BARS) continue; // need a full-ish year
    const s = h.series;
    const m = seriesStats(s);
    stats.push({
      symbol,
      ret1y: m.returnPct,
      ret3m: (s[s.length - 1] / s[s.length - 1 - QUARTER_BARS] - 1) * 100,
      vol: m.volPct,
      maxDd: m.maxDrawdownPct,
    });
  }

  // Full aligned series for the walk-forward engine (only symbols with stats).
  const tails = new Map<string, number[]>();
  for (const a of stats) tails.set(a.symbol, (histories.get(a.symbol) as { series: number[] }).series);

  const kept = new Set(stats.map((a) => a.symbol));
  return { stats, tails, skipped: symbols.filter((s) => !kept.has(s)) };
}

async function build(): Promise<StrategiesPayload> {
  const symbols = [...STOCKS, ...ETFS].map((a) => a.symbol);
  const { stats, tails } = await buildUniverseData(symbols);

  const etfSyms = new Set(ETFS.map((a) => a.symbol));
  const etfs = stats.filter((a) => etfSyms.has(a.symbol));
  const stocks = stats.filter((a) => !etfSyms.has(a.symbol));

  const defs: (Omit<PublicStrategy, "backtest"> & { rule: Rule })[] = [
    {
      id: "steady-foundation",
      name: "Steady Foundation",
      tagline: "The calm core: every fund, sized by how steady it actually is.",
      method:
        "Universe: all tokenized ETFs with 12 months of public history. Weights: inverse to each fund's annualized daily volatility, capped at 30% per fund (excess redistributes). Rebalanced monthly. Refreshed from market data every 6 hours.",
      allocations: steadyFoundation(etfs),
      rule: (e) => steadyFoundation(e),
    },
    {
      id: "momentum-leaders",
      name: "Momentum Leaders",
      tagline: "The 8 strongest uptrends, sized so no single name can sink it.",
      method:
        "Universe: all tokenized stocks with 12 months of public history. Filter: 1-year AND 3-month returns both positive. Rank: 0.7 x 1-year return + 0.3 x annualized 3-month return, take the top 8. Weights: inverse volatility, capped at 20% per stock. Rebalanced monthly. Refreshed every 6 hours.",
      allocations: momentumLeaders(stocks),
      rule: (_e, st) => momentumLeaders(st),
    },
    {
      id: "balanced-growth",
      name: "Balanced Growth",
      tagline: "A market core with a momentum engine bolted on.",
      method:
        "55% core: all index/sector ETFs (treasuries excluded), inverse-vol weighted, 40% cap. 45% growth: the Momentum Leaders sleeve. Blended, then rounded to whole percents. Rebalanced monthly. Refreshed every 6 hours.",
      allocations: balancedGrowth(etfs, stocks),
      rule: (e, st) => balancedGrowth(e, st),
    },
  ];

  const strategies: PublicStrategy[] = defs.map(({ rule, ...d }) => {
    let backtest: StrategyBacktest | null = null;
    try {
      backtest = walkForward(rule, tails, etfSyms);
    } catch {
      /* a data hiccup never hides the strategy itself */
    }
    return { ...d, backtest };
  });

  return {
    asOf: new Date().toISOString(),
    refreshedEvery: "6h",
    note: "Deterministic rules over real daily closes (real underlying tickers). Backtests are WALK-FORWARD: each month the rule re-runs using only the data it would have had at that moment, then holds out-of-sample, monthly rebalance, vs buy-and-hold SPY over the same window. History, not a promise: markets change.",
    strategies,
  };
}

/** The public strategies payload (cached 6h; failed builds are not cached). */
export function getPublicStrategies(): Promise<StrategiesPayload> {
  if (payloadCache && Date.now() - payloadCache.at < PAYLOAD_TTL_MS) return payloadCache.value;
  const value = build().catch((err) => {
    payloadCache = null;
    throw err;
  });
  payloadCache = { at: Date.now(), value };
  return value;
}
