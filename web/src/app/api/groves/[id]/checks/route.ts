import type { NextRequest } from "next/server";
import { groveById } from "@/lib/groves";
import { listOutcomesForUser } from "@/lib/server/rebalanceStore";
import type { RebalanceOutcomeRow } from "@/lib/server/rebalanceStore";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { jsonError, tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/groves/[id]/checks?address=0x… — every window Vera has checked THIS
// holder's basket in, newest first, each with what she decided and why.
//
// Why this exists next to /history: the chain can only show rebalances that
// HAPPENED. A basket correctly left alone produces no transaction, so a grove
// being managed perfectly looked exactly like one nobody was watching. Three
// windows ran on 2026-08-04 and the panel showed nothing, which reads as
// broken. A check that decided not to trade is the more common outcome and
// belongs on the page.
//
// Keyed by the Grove account (the smart account that owns the position), which
// is the address the ledger stores. Public like the rest of /api/groves, on the
// /api/portfolio precedent: it describes a position whose trades are already
// public on-chain.
export const dynamic = "force-dynamic";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export interface GroveCheckRow {
  at: number;
  outcome: RebalanceOutcomeRow["outcome"];
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

export function toCheckRow(row: RebalanceOutcomeRow): GroveCheckRow {
  // createdAt is when the window recorded this outcome (epoch ms).
  const base = { at: row.createdAt, outcome: row.outcome, txHash: row.txHash, turnoverUsd: row.turnoverUsd };
  switch (row.outcome) {
    case "rebalanced":
      return { ...base, title: "Basket realigned", detail: veraSentence(row, "Weights were brought back to their published targets.") };
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(`groves:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const { id } = await params;
    const def = groveById(id.toLowerCase());
    if (!def) return jsonError(404, "No such grove.");
    const address = req.nextUrl.searchParams.get("address") ?? "";
    if (!ADDR.test(address)) return jsonError(400, "A valid address is required.");

    const rows = (await listOutcomesForUser(address, def.id, 40)).map(toCheckRow);
    return Response.json(
      { rows, asOf: new Date().toISOString() },
      // Short: a window closes every six hours, and a holder refreshing right
      // after one should see it.
      { headers: { "Cache-Control": "private, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    return serverError("groves-checks", err);
  }
}
