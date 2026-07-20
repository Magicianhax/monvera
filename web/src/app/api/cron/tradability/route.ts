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

// Hysteresis: a name LOCKS only after this many consecutive missed sweeps
// (venue books flap and probe 429s read as misses — one bad hour must not
// flap the UI), and UNLOCKS the moment any sweep finds a route again.
const LOCK_AFTER = 2;

interface KvNs {
  get(k: string): Promise<string | null>;
  put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return unauthorized();
  try {
    let kv: KvNs | null = null;
    try {
      kv = (getCloudflareContext().env as { KV?: KvNs }).KV ?? null;
    } catch {
      /* local dev has no KV */
    }
    const prevMisses: Record<string, number> = await (async () => {
      try {
        const raw = await kv?.get(TRADABILITY_KV_KEY);
        return raw ? ((JSON.parse(raw) as { misses?: Record<string, number> }).misses ?? {}) : {};
      } catch {
        return {};
      }
    })();

    const sweep = await sweepTradability();
    const misses: Record<string, number> = {};
    for (const s of sweep.dropped) misses[s] = (prevMisses[s] ?? 0) + 1;
    const locked = sweep.dropped.filter((s) => (misses[s] ?? 0) >= LOCK_AFTER);
    const body = {
      ok: [...sweep.ok, ...sweep.dropped.filter((s) => (misses[s] ?? 0) < LOCK_AFTER)].sort(),
      dropped: locked,
      asOf: sweep.asOf,
      misses,
    };
    // 24h TTL: a broken cron degrades to "stale but honest", then to open.
    await kv?.put(TRADABILITY_KV_KEY, JSON.stringify(body), { expirationTtl: 24 * 60 * 60 }).catch(() => {});
    return Response.json({ ok: body.ok.length, locked, pending: sweep.dropped.filter((s) => !locked.includes(s)), asOf: sweep.asOf });
  } catch (err) {
    return serverError("cron-tradability", err);
  }
}
