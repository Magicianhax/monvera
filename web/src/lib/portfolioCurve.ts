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
  /** Parts of the holding the EOA can't sell right now — settling fills,
   *  Grove-held shares, staked tokens. They move with the market all the same,
   *  so the curve values them like everything else. */
  settlingUsd?: number;
  smartUsd?: number;
  stakedUsd?: number;
  spark?: number[];
}

/** Full worth of one curve holding. */
const curveWorth = (h: CurveHolding): number =>
  (h.valueUsd ?? 0) + (h.settlingUsd ?? 0) + (h.smartUsd ?? 0) + (h.stakedUsd ?? 0);

const N = 24; // common resolution for all holdings

export interface EquitySnapshot {
  takenAt: number;
  totalUsd: number;
}

/**
 * The real equity curve: hourly balance snapshots (from /api/balance-history)
 * with the LIVE total appended as the final point. Needs at least 3 snapshots
 * to say anything — below that, callers fall back to the intraday holdings
 * curve. Snapshots capture deposits, sends, and trades — the intraday curve
 * can't.
 */
export function equityCurveFrom(snapshots: EquitySnapshot[], liveTotalUsd: number | undefined, hours = 24): DayCurve | null {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const pts = snapshots.filter((s) => s.takenAt >= since).map((s) => s.totalUsd);
  if (pts.length < 3) return null;
  // The live total is appended ONLY once the portfolio query has answered.
  // Snapshots are edge-cached and usually land first; appending a not-yet-known
  // total as 0 drew a cliff crashing to zero on every load.
  const curve = typeof liveTotalUsd === "number" ? [...pts, liveTotalUsd] : pts;
  const open = curve[0];
  const last = curve[curve.length - 1];
  const changeUsd = last - open;
  return { curve, changeUsd, changePct: open > 0 ? (changeUsd / open) * 100 : 0 };
}

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
 *
 * Pass `cashUsd` so the curve is the TOTAL balance through the day — without
 * it, a $0.01 position under $0.72 of cash renders as the whole chart and its
 * noise reads as the user's money swinging.
 */
export function portfolioDayCurve(holdings: CurveHolding[], cashUsd = 0): DayCurve | null {
  const priced = holdings.filter((h) => curveWorth(h) > 0);
  if (priced.length === 0) return null;

  const sum = new Array<number>(N).fill(cashUsd);
  let anyMovement = false;
  for (const h of priced) {
    const value = curveWorth(h);
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
