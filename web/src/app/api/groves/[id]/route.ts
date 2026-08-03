import type { NextRequest } from "next/server";
import { getGrove, grovesDegraded } from "@/lib/server/groveService";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { jsonError, tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/groves/[id] — one grove with live prices, on-chain stats, and its
// 1Y backtest. Public like the list: transparency is the point. Human version:
// /groves/[id].
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limit = rateLimit(`groves:${clientIp(req)}`, 120, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const { id } = await params;
    const grove = await getGrove(id.toLowerCase());
    if (!grove) return jsonError(404, "No such grove.");
    // Same rule as the list: a failed stats read must not stick at the edge.
    return Response.json(grove, {
      headers: {
        "Cache-Control": grovesDegraded([grove])
          ? "no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    return serverError("groves-detail", err);
  }
}
