import type { NextRequest } from "next/server";
import { getPublicStrategies } from "@/lib/server/strategies";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/strategies — Monvera's public, deterministic strategy book:
// rule-based weights computed from real 12-month data + a backtest for each,
// as JSON so anyone (people, agents, other apps) can consume and verify it.
// Human version: /strategies.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`strategies:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const payload = await getPublicStrategies();
    return Response.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" },
    });
  } catch (err) {
    return serverError("strategies", err);
  }
}
