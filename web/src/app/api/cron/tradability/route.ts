// /api/cron/tradability — hourly two-way liquidity sweep of the whole
// universe, persisted to KV for /api/tradability (the market UI and buy
// surfaces read it). Fired by the Cloudflare Cron Trigger (worker.ts).
// Auth: same bearer-secret scheme as the other crons.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sweepTradability, TRADABILITY_KV_KEY } from "@/lib/server/tradability";
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
  try {
    const sweep = await sweepTradability();
    try {
      const env = getCloudflareContext().env as { KV?: { put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> } };
      // 24h TTL: a broken cron degrades to "stale but honest", then to open.
      await env.KV?.put(TRADABILITY_KV_KEY, JSON.stringify(sweep), { expirationTtl: 24 * 60 * 60 });
    } catch {
      /* local dev has no KV — the sweep result still returns */
    }
    return Response.json({ ok: sweep.ok.length, dropped: sweep.dropped, asOf: sweep.asOf });
  } catch (err) {
    return serverError("cron-tradability", err);
  }
}
