// "Why it moved" — a plain-words, HONEST context sentence for a stock's day
// move: how it compares to its sector peers and the S&P 500. No invented news,
// no headline read — just real market movement put in perspective. Deterministic
// (built from the same day-summary the sparklines use).
import { ALL_ASSETS } from "./tokens";
import { displayFor } from "./displayAssets";

type Summary = Record<string, { dayChangePct: number; spark: number[] }>;

function move(v: number): string {
  const dir = v >= 0 ? "up" : "down";
  return `${dir} ${Math.abs(v).toFixed(1)}%`;
}

/**
 * A one-sentence context line for `symbol` today, or null if we lack its day
 * move. Compares to same-category peers (average) and SPY when available.
 */
export function whyItMoved(symbol: string, summary: Summary | undefined): { text: string; up: boolean } | null {
  const me = summary?.[symbol]?.dayChangePct;
  if (me === undefined || summary === undefined) return null;

  const d = displayFor(symbol);
  const cat = d.cat;
  const peerMoves: number[] = [];
  for (const a of ALL_ASSETS) {
    if (a.symbol === symbol) continue;
    if (displayFor(a.symbol).cat !== cat) continue;
    const v = summary[a.symbol]?.dayChangePct;
    if (v !== undefined) peerMoves.push(v);
  }
  const peerAvg = peerMoves.length >= 2 ? peerMoves.reduce((s, v) => s + v, 0) / peerMoves.length : undefined;
  const spy = symbol === "SPY" ? undefined : summary["SPY"]?.dayChangePct;

  const catLabel =
    cat === "Funds" ? "funds" : cat === "Cash" ? "cash" : `${cat.toLowerCase()} names`;

  const clauses: string[] = [];
  if (peerAvg !== undefined) clauses.push(`${catLabel} are ${move(peerAvg)} on average`);
  if (spy !== undefined) clauses.push(`the S&P 500 is ${move(spy)}`);

  let text = `${d.name} is ${move(me)} today`;
  if (clauses.length === 1) text += `, while ${clauses[0]}.`;
  else if (clauses.length === 2) text += `, while ${clauses[0]} and ${clauses[1]}.`;
  else text += ".";

  return { text, up: me >= 0 };
}
