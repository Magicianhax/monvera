// GET /api/activity?address=0x… — a user's Monvera on-chain activity (AI invests
// via the executor), newest first. Public chain data, no auth — rate limited
// per IP, scan cached server-side. Same reason as /api/vera-record: the full
// deploy→latest eth_getLogs range exceeds the public RPC's 10k-block cap.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { getUserActivityServer } from "@/lib/server/executorLogs";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`activity:${clientIp(req)}`, 120, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return badRequest("A valid wallet address is required.");

  try {
    const activity = await getUserActivityServer(address as `0x${string}`);
    return Response.json(
      { activity: activity.map((a) => ({ ...a, blockNumber: Number(a.blockNumber) })) },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch (err) {
    return serverError("activity", err);
  }
}
