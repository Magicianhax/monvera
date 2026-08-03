import type { NextRequest } from "next/server";
import { groveById } from "@/lib/groves";
import { getGroveHistory } from "@/lib/server/groveHistory";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { jsonError, tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/groves/[id]/history — every on-chain touch of this grove, newest
// first: per-member rebalances and recipe (composition) changes, read straight
// from GroveManager's events. Public like the rest of /api/groves —
// transparency is the point. An empty list is the honest launch state.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limit = rateLimit(`groves:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const { id } = await params;
    const def = groveById(id.toLowerCase());
    if (!def) return jsonError(404, "No such grove.");
    // Not on-chain yet — an honest empty, not an error: the page shows the
    // same panel with its "none yet" state.
    const history =
      def.onChainId === undefined
        ? { rows: [], asOf: new Date().toISOString() }
        : await getGroveHistory(def.onChainId);
    return Response.json(history, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" },
    });
  } catch (err) {
    return serverError("groves-history", err);
  }
}
