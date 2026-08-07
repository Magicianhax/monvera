import "server-only";

// Turning a ledger row into the sentence a holder reads.
//
// This lives here, NOT in the route, because an App Router `route.ts` may only
// export HTTP methods and route config. Exporting a helper from one fails the
// webpack build's route-type validation (`next build --webpack`) while passing
// a plain Turbopack `next build`, so it looks fine locally and dies in deploy.
import type { RebalanceOutcomeRow, RebalanceOutcome } from "./rebalanceStore";

export interface GroveCheckRow {
  /** Epoch MILLISECONDS. */
  at: number;
  outcome: RebalanceOutcome;
  /** Short label for the row. */
  title: string;
  /** One honest sentence. Never a raw internal string. */
  detail: string;
  txHash?: string;
  turnoverUsd?: number;
}

/** Vera's own sentence, but only when the deterministic lint passed. A reason
 *  that failed the lint stays in the ledger and is replaced here, exactly as
 *  displayReason() does for notifications — the panel must never be the one
 *  surface that shows unchecked model prose. */
function veraSentence(row: RebalanceOutcomeRow, fallback: string): string {
  if (row.veraReason && row.lintOk) return row.veraReason;
  return fallback;
}

/**
 * What a rebalance moved the basket TOWARD, named honestly.
 *
 * Shared with the notification builder in autoRebalance.ts on purpose: both
 * surfaces used to hardcode "its published weights" for every rebalance, which
 * is false whenever Vera tilted — and she may scale any name 0.7-1.3x, so the
 * basis can differ from the published composition by several points. The same
 * class was already fixed once for the judge's own input rows after the
 * 2026-08-05 incident where a recorded reason read "buying TSLA back to shape"
 * on a run that SOLD TSLA down to Vera's lowered target; the fix never reached
 * the copy. One function now, so a third surface cannot re-introduce it.
 *
 * `undefined` means the row predates tilt provenance. It must NOT collapse to
 * "published" — an unknown basis gets wording that claims nothing specific.
 */
export function targetBasisName(tiltSource?: "model" | "base"): string {
  if (tiltSource === "base") return "the basket's published weights";
  if (tiltSource === "model") return "Vera's targets for this window";
  return "the basket's target weights";
}

export function toCheckRow(row: RebalanceOutcomeRow): GroveCheckRow {
  // createdAt is when the window recorded this outcome (epoch ms).
  const base = { at: row.createdAt, outcome: row.outcome, txHash: row.txHash, turnoverUsd: row.turnoverUsd };
  switch (row.outcome) {
    case "rebalanced":
      return {
        ...base,
        title: "Basket realigned",
        detail: veraSentence(row, `Weights were brought back toward ${targetBasisName(row.tiltSource)}.`),
      };
    case "no-drift":
      // The stored reason is an engineer's string ("no actionable plan (drift
      // under 500 bps…)"). It is accurate but it is not the sentence to show.
      return { ...base, title: "Checked, already on target", detail: "Nothing had drifted far enough to be worth the trading cost." };
    case "defer-market":
      return { ...base, title: "Checked, chose to wait", detail: veraSentence(row, "Vera judged this a poor window to trade in and waited.") };
    case "defer-outage":
      return { ...base, title: "Checked, waiting for the next window", detail: "Vera could not complete her market check, so nothing was traded." };
    case "pricing-unavailable":
      return { ...base, title: "Checked, prices were not fresh", detail: "The on-chain price feeds were stale, so the contract allowed no trade." };
    case "off-session":
      return { ...base, title: "Checked outside a trading window", detail: "The basket was left alone until the next window." };
    case "skipped":
      return { ...base, title: "Skipped this window", detail: "Nothing was traded in this window." };
    case "failed":
      return { ...base, title: "Rebalance did not go through", detail: "The transaction did not succeed, so the basket is unchanged." };
    case "unconfirmed":
      return { ...base, title: "Rebalance sent", detail: "Waiting for the transaction to confirm on-chain." };
  }
}
