// GET /api/transactions?address=0x…[&smart=0x…] — a user's incoming + outgoing
// transfers, newest first. Uses Alchemy (better infra) when ALCHEMY_API_KEY is
// set, with an on-chain log-scan fallback. Public chain data, so no auth — but
// rate limited per IP since it can drive RPC cost.
//
// `smart` is the caller's ERC-4337 smart account. Grove buys/exits execute
// THERE (GroveManager keys on msg.sender), so a feed swept from the EOA alone
// showed a grove buy as "Sent cash" to a stranger and a grove exit as nothing
// at all. Both sweeps are merged; each row is tagged with its account so the
// client can collapse internal EOA<->smart moves into one honest event.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { getWalletTransfers, TXN_SOURCE } from "@/lib/server/walletTransfers";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import type { WalletTx } from "@/lib/walletTx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`transactions:${clientIp(req)}`, 120, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return badRequest("A valid wallet address is required.");
  const smartParam = req.nextUrl.searchParams.get("smart");
  const smart =
    smartParam && isAddress(smartParam) && smartParam.toLowerCase() !== address.toLowerCase()
      ? (smartParam as `0x${string}`)
      : null;

  try {
    const [eoaTxs, smartTxs] = await Promise.all([
      getWalletTransfers(address),
      smart ? getWalletTransfers(smart) : Promise.resolve([] as WalletTx[]),
    ]);
    const transactions: WalletTx[] = [
      ...eoaTxs.map((t) => ({ ...t, account: "eoa" as const })),
      ...smartTxs.map((t) => ({ ...t, account: "smart" as const })),
    ].sort((a, b) => b.blockNumber - a.blockNumber);
    return Response.json(
      { transactions, source: TXN_SOURCE },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return serverError("transactions", err);
  }
}
