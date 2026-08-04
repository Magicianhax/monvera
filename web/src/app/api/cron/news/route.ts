// /api/cron/news — the hourly news sweep on what users hold (worker.ts
// scheduled(), fanned out of the existing hourly slot; no cron slot is
// consumed). Notifications only: Vera never trades on news. Kill order: KV
// news:kill (checked inside the sweep, fail closed, flippable in seconds
// without a deploy) is the incident brake; NEWS_ALERTS=off here is the
// deploy-time secondary and short-circuits the FETCH, not just the send.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runNewsSweep } from "@/lib/server/newsAlerts";
import { unauthorized, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

// Constant-time compare — the same secret guards /api/cron/autopilot, which
// moves money, so a timing oracle here would leak the key for that route too.
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
  if ((process.env.NEWS_ALERTS ?? "on") === "off") {
    return Response.json({ ran: false, reason: "NEWS_ALERTS=off" });
  }
  try {
    return Response.json(await runNewsSweep());
  } catch (err) {
    return serverError("cron-news", err);
  }
}
