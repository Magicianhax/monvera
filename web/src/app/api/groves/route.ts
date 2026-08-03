import type { NextRequest } from "next/server";
import { getGroves, grovesDegraded } from "@/lib/server/groveService";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/groves — the full public Grove book: compositions, exclusions,
// methodology, fees, live prices, on-chain stats, and a 1Y backtest each, as
// JSON so anyone (people, agents, DefiLlama-class trackers) can consume and
// verify it. Transparency is the product, so no auth — just an IP rate limit.
// Human version: /groves.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`groves:${clientIp(req)}`, 120, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const payload = await getGroves();
    // A degraded payload (a launched grove whose stats read failed) must not
    // be pinned at the edge — SWR once kept "opens soon" on screen minutes
    // after the origin recovered.
    return Response.json(payload, {
      headers: {
        "Cache-Control": grovesDegraded(payload.groves)
          ? "no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    return serverError("groves", err);
  }
}
