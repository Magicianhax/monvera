import type { NextRequest } from "next/server";
import { getGroves, grovesDegraded, grovesEpoch, EPOCH_NOCACHE_MS } from "@/lib/server/groveService";
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
    // Two reasons never to let the edge pin this response:
    //
    //  1. A degraded payload (a launched grove whose stats read failed) — SWR
    //     once kept "opens soon" on screen minutes after the origin recovered.
    //  2. A buy or exit landed in the last couple of minutes. The origin is
    //     already correct by then, but stale-while-revalidate would keep
    //     serving the pre-trade numbers to everyone else — which is exactly
    //     what left "Investors 2" on screen after the second holder had
    //     closed. Freshness beats cache hits for the short window where the
    //     numbers visibly changed.
    const recentlyMutated = Date.now() - grovesEpoch() < EPOCH_NOCACHE_MS;
    return Response.json(payload, {
      headers: {
        "Cache-Control":
          grovesDegraded(payload.groves) || recentlyMutated
            ? "no-store"
            : "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    return serverError("groves", err);
  }
}
