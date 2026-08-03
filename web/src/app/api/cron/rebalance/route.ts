// /api/cron/rebalance — the six-hour auto-manage pass (worker.ts scheduled()).
// Consent and caps live on-chain per user; this only runs the drift check and
// executes inside them (lib/server/autoRebalance). Auth: the same bearer-secret
// scheme as every other cron. Kill order: KV rebalance:kill (checked inside the
// driver, fail closed, flippable in seconds without a deploy) is the incident
// brake; AUTO_REBALANCE=off here is the deploy-time secondary.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAutoRebalance } from "@/lib/server/autoRebalance";
import { runIdForWindow } from "@/lib/server/rebalanceStore";
import { unauthorized, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const secret = process.env.AUTOPILOT_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return unauthorized();
  if ((process.env.AUTO_REBALANCE ?? "on") === "off") {
    return Response.json({ ran: false, runId: runIdForWindow(), reason: "AUTO_REBALANCE=off" });
  }
  try {
    return Response.json(await runAutoRebalance());
  } catch (err) {
    return serverError("cron-rebalance", err);
  }
}
