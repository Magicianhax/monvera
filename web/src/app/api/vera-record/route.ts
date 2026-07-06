// GET /api/vera-record[?user=0x…] — Vera's on-chain track record (global, or
// scoped to one user) + her IdentityRegistry reputation. Public chain data, no
// auth — rate limited per IP, and the underlying scan is cached server-side.
// Exists because browsers can't eth_getLogs the full deploy→latest range
// against the public RPC (10k-block cap); the server uses Etherscan's index.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { getVeraRecordServer, getReputationServer } from "@/lib/server/executorLogs";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`vera-record:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const user = req.nextUrl.searchParams.get("user");
  if (user && !isAddress(user)) return badRequest("user must be a valid address.");

  try {
    const [record, reputation] = await Promise.all([
      getVeraRecordServer((user as `0x${string}`) ?? undefined),
      getReputationServer(),
    ]);
    return Response.json(
      {
        record: {
          ...record,
          recentRecommendations: record.recentRecommendations.map((r) => ({
            ...r,
            blockNumber: Number(r.blockNumber), // bigint -> JSON-safe
          })),
        },
        reputation: reputation === null ? null : reputation.toString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    return serverError("vera-record", err);
  }
}
