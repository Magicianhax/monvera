// Build a "today" value curve for the current holdings: what the assets you
// own right now were worth across today's session, from each holding's intraday
// price shape (spark) scaled to its current value. This is the market movement
// of your current holdings today, NOT cost-basis profit (we don't track what you
// paid), so it's honest to show as "portfolio value today", not "profit".

export interface DayCurve {
  /** Portfolio value at each step through the day (oldest -> now). */
  curve: number[];
  /** Dollar change across the day (now - open). */
  changeUsd: number;
  /** Percent change across the day. */
  changePct: number;
}

interface CurveHolding {
  valueUsd?: number;
  spark?: number[];
}

const N = 24; // common resolution for all holdings

/** Linear-resample a series to exactly `n` points (keeps first + last). */
function resample(series: number[], n: number): number[] {
  if (series.length === n) return series;
  if (series.length < 2) return Array(n).fill(series[0] ?? 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i * (series.length - 1)) / (n - 1);
    const i0 = Math.floor(t);
    const frac = t - i0;
    out.push(series[i0] + ((series[i0 + 1] ?? series[i0]) - series[i0]) * frac);
  }
  return out;
}

/**
 * Aggregate value curve for the holdings' current value over today. Returns null
 * when nothing is priced (no honest curve to draw). Holdings without a live
 * spark contribute a flat line at their current value.
 */
export function portfolioDayCurve(holdings: CurveHolding[]): DayCurve | null {
  const priced = holdings.filter((h) => (h.valueUsd ?? 0) > 0);
  if (priced.length === 0) return null;

  const sum = new Array<number>(N).fill(0);
  let anyMovement = false;
  for (const h of priced) {
    const value = h.valueUsd ?? 0;
    const spark = h.spark;
    if (spark && spark.length >= 2 && spark[spark.length - 1] > 0) {
      anyMovement = true;
      const scaled = resample(spark, N).map((p) => (p / spark[spark.length - 1]) * value);
      for (let i = 0; i < N; i++) sum[i] += scaled[i];
    } else {
      for (let i = 0; i < N; i++) sum[i] += value; // flat contribution
    }
  }
  if (!anyMovement) return null; // every holding flat -> a flat line says nothing

  const open = sum[0];
  const now = sum[sum.length - 1];
  const changeUsd = now - open;
  const changePct = open > 0 ? (changeUsd / open) * 100 : 0;
  return { curve: sum, changeUsd, changePct };
}

/**
 * Portfolio value curve over ANY range: each holding's price series (real closes
 * for that range) scaled to its current value, plus cash as a flat line. Same
 * honesty as portfolioDayCurve — it's the market value of what you hold now over
 * the window, not cost-basis profit.
 */
export function combinePortfolioCurve(
  parts: { valueUsd: number; series?: number[] }[],
  cash: number,
  points = 56,
): DayCurve | null {
  const priced = parts.filter((p) => p.valueUsd > 0);
  if (priced.length === 0) return null;

  const sum = new Array<number>(points).fill(0);
  let anyMovement = false;
  for (const p of priced) {
    const s = p.series;
    if (s && s.length >= 2 && s[s.length - 1] > 0) {
      anyMovement = true;
      const scaled = resample(s, points).map((v) => (v / s[s.length - 1]) * p.valueUsd);
      for (let i = 0; i < points; i++) sum[i] += scaled[i];
    } else {
      for (let i = 0; i < points; i++) sum[i] += p.valueUsd;
    }
  }
  if (cash > 0) for (let i = 0; i < points; i++) sum[i] += cash;
  if (!anyMovement) return null;

  const open = sum[0];
  const now = sum[sum.length - 1];
  const changeUsd = now - open;
  const changePct = open > 0 ? (changeUsd / open) * 100 : 0;
  return { curve: sum, changeUsd, changePct };
}
