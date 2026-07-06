// GET /api/transactions?address=0x… — a wallet's incoming + outgoing transfers,
// newest first. Uses Alchemy (better infra) when ALCHEMY_API_KEY is set, with an
// on-chain log-scan fallback. Public chain data, so no auth — but rate limited
// per IP since it can drive RPC cost.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { getWalletTransfers, TXN_SOURCE } from "@/lib/server/walletTransfers";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`transactions:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return badRequest("A valid wallet address is required.");

  try {
    const transactions = await getWalletTransfers(address);
    return Response.json(
      { transactions, source: TXN_SOURCE },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return serverError("transactions", err);
  }
}
