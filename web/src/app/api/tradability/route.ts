// GET /api/tradability — the two-way tradable universe (buyable AND sellable
// right now), from the hourly cron sweep in KV. The market screen filters its
// list with this and the buy ticket refuses one-way names.
//
// `ok: null` means "no sweep yet" — clients must treat that as unknown and
// not hide anything (fail open: a missing cron never blanks the market).
import type { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TRADABILITY_KV_KEY, type TradabilitySweep } from "@/lib/server/tradability";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`tradability:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let sweep: TradabilitySweep | null = null;
  try {
    const env = getCloudflareContext().env as { KV?: { get(k: string): Promise<string | null> } };
    const raw = await env.KV?.get(TRADABILITY_KV_KEY);
    if (raw) sweep = JSON.parse(raw) as TradabilitySweep;
  } catch {
    /* no KV (local dev) or parse failure — fall through to unknown */
  }
  return Response.json(
    sweep ? { ok: sweep.ok, dropped: sweep.dropped, asOf: sweep.asOf } : { ok: null, dropped: [], asOf: null },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
