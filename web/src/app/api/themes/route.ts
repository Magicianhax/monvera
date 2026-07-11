import type { NextRequest } from "next/server";
import { getPublicThemes } from "@/lib/server/themes";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/themes — the open theme book: one deterministic basket per
// investing theme (weights + walk-forward backtest vs SPY), as JSON so anyone
// (people, agents, other apps) can consume and verify it. Human version:
// /themes. World-readable by design — it moves no money.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`themes:${clientIp(req)}`, 120, 60_000 /* per-IP: generous — shared IPs */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const payload = await getPublicThemes();
    return Response.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" },
    });
  } catch (err) {
    return serverError("themes", err);
  }
}
