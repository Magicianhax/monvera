// GET /api/screener — ranked, plain-language stats for the buyable universe.
//
// Returns real 12-month numbers per buyable asset (1y return, 3-month momentum,
// annualized volatility, worst drawdown) so the client can sort them into a
// leaderboard. Shares quant.ts's cached sweep with the allocation prompt, so a
// screenful of clients costs at most one upstream build per TTL window.
//
// Public data like /api/market: rate-limited per IP, no auth.
import type { NextRequest } from "next/server";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { universeStatsRows } from "@/lib/server/quant";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

// Only assets that are actually buyable in one tap (exclude `coming` tiers) —
// mirrors the BUYABLE set the allocator ranks over.
const BUYABLE = ALL_ASSETS.filter((a) => !displayFor(a.symbol).coming);

export async function GET(req: NextRequest) {
  const limit = rateLimit(`screener:${clientIp(req)}`, 120, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    const rows = await universeStatsRows(BUYABLE.map((a) => a.symbol));
    // Drop assets with no honest public history — never rank a faked series.
    const assets = rows.filter((r) => !r.noData);
    return Response.json(
      { assets, asOf: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } },
    );
  } catch (err) {
    return serverError("screener", err);
  }
}
