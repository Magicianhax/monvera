import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { claimDueAutopilots } from "@/lib/server/autopilotStore";
import { runAutopilot } from "@/lib/server/autopilotExecutor";

// Scheduled, autonomous runs — never cache. Allow up to 5 min for a batch.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Auth: a shared secret in the Authorization header ONLY (Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`). No URL-borne secret — query strings
// leak into access logs/proxies. Compared in constant time. Set
// AUTOPILOT_CRON_SECRET (and, on Vercel, CRON_SECRET) to the same value.
function authorized(req: NextRequest): boolean {
  const secret = process.env.AUTOPILOT_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const now = Math.floor(Date.now() / 1000);
  const due = await claimDueAutopilots(now);

  const results: Array<{ id: string; ok: boolean; txHash?: string; reason?: string }> = [];
  for (const cfg of due) {
    try {
      const r = await runAutopilot(cfg, { nowSeconds: now });
      results.push({ id: cfg.id, ...r });
    } catch (e) {
      results.push({ id: cfg.id, ok: false, reason: e instanceof Error ? e.message : "run failed" });
    }
  }

  return Response.json({ checkedAt: now, due: due.length, ran: results.length, results });
}
