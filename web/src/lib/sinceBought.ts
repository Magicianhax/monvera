// "Since you bought" — the STOCK's market move from your entry date to now.
// This is deliberately NOT cost-basis P&L: it uses the market close on the day
// you first bought vs the latest close, so it's the ticker's move over your
// holding window, framed honestly (we don't track what you paid).

export interface SinceBought {
  /** Percent move of the stock from the entry-date close to now. */
  pct: number;
  up: boolean;
  /** Unix-seconds of the aligned entry close (for the date label). */
  entryTs: number;
}

/**
 * Given the first-buy timestamp and a dated close series, compute the stock's
 * market move since entry. Returns null when the history can't cover it.
 */
export function sinceBought(
  entryTs: number | undefined,
  timestamps: number[] | null | undefined,
  series: number[] | null | undefined,
  currentPrice: number | undefined,
): SinceBought | null {
  if (!entryTs || !timestamps || !series || timestamps.length !== series.length || series.length < 2) return null;
  // The entry must fall within (or at the start of) the history we have.
  if (entryTs < timestamps[0] - 5 * 86_400) return null; // entry older than our window

  // Nearest close on or just before the entry date.
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - entryTs);
    if (diff < best) {
      best = diff;
      idx = i;
    }
  }
  const entryClose = series[idx];
  if (!entryClose || entryClose <= 0) return null;
  const last = currentPrice && currentPrice > 0 ? currentPrice : series[series.length - 1];
  const pct = ((last - entryClose) / entryClose) * 100;
  if (!Number.isFinite(pct)) return null;
  return { pct, up: pct >= 0, entryTs: timestamps[idx] };
}
