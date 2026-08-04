// Deterministic wording checks shared by every surface that puts model prose in
// front of a customer (rebalance verdicts, news alerts).
//
// Pure strings: no bindings, no IO, no "server-only" — the news sweep, the
// rebalance judgment and the hand-rolled check script all import the SAME
// patterns, so a rule can never drift between two copies of the list.

// Forward-looking language Vera's copy may never contain: she reports what the
// tape already did, never what it will do. A false positive only costs a
// neutral fallback (rebalance) or a dropped alert (news), so the list errs
// strict.
export const FORWARD_LOOKING: RegExp[] = [
  /\bwill\b/i,
  /\bwon['’]t\b/i,
  /\bgoing to\b/i,
  /\btomorrow\b/i,
  /\bexpect\w*\b/i,
  /\bpredict\w*\b/i,
  /\bforecast\w*\b/i,
  /\banticipat\w*\b/i,
  /\bshould\s+(?:\w+\s+){0,2}(?:rise|rally|rebound|recover|climb|gain|surge|fall|drop|dip|slide|decline|sink)\b/i,
  /\b(?:likely|poised|bound|due|about|set)\s+to\s+(?:\w+\s+){0,2}(?:rise|rally|rebound|recover|climb|gain|surge|fall|drop|dip|slide|decline|sink|move|run)\b/i,
  /\bprice target\b/i,
  /\btarget\s+(?:price|of\s+\$)/i,
];

// Prediction language in an ORIGINAL headline, rejected before any model sees
// the item. Aggregator feeds carry valuation-mill and "AI predicts the price"
// slop; a classifier asked to triage it will occasionally say yes.
export const PREDICTIVE_TITLE: RegExp[] = [
  /\bpredicts?\b/i,
  /\bprice target\b/i,
  /\bforecasts?\b/i,
  /\bcould (?:hit|reach|soar|double)\b/i,
  /\bset to (?:soar|surge|plunge)\b/i,
  /\bwhere .* be in \d+ years?\b/i,
  /\bis it (?:a buy|too late)\b/i,
];

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasForwardLooking(text: string): boolean {
  return FORWARD_LOOKING.some((p) => p.test(text));
}

/** True when `text` names at least one of `symbols` on a word boundary. */
export function namesSymbol(text: string, symbols: string[]): boolean {
  return symbols.some((sym) => new RegExp(`\\b${escapeRegExp(sym)}\\b`, "i").test(text));
}

/** House typography for user copy: no em dashes, no curly quotes. Headlines
 *  carry both (~4% of sampled Yahoo headlines have an em dash), so any string
 *  derived from one passes through here before it reaches D1. */
export function normalizeCopy(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^[\s–—]+/, "")
    .replace(/[\s–—]+$/, "")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}
