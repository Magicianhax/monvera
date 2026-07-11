// GET /api/prices — live USD spot for every Monvera asset, read from DEX pools.
// Cached briefly (the underlying pools move slowly relative to a page view) so a
// burst of clients doesn't hammer the RPC. Stocks price off Fluxion, sUSDe/mETH
// off their Agni route; assets with no live source report priceUsd: null.
import type { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { MULTICALL3 } from "@/lib/tokens";
import { chain } from "@/lib/chain";
import { priceAllWithFallback } from "@/lib/server/pricing";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, serverError } from "@/lib/server/respond";

export const revalidate = 0; // we manage caching via Cache-Control below

import { SERVER_RPC_URL } from "@/lib/server/rpc";

const RPC_URL = SERVER_RPC_URL;

// batch.multicall folds the ~30 parallel pool reads (15 assets × slot0/token0)
// into one eth_call. Without it the public RPC rate-limits the tail of the burst
// and the late assets (SPY, QQQ, sUSDe, mETH) silently price as "none".
const publicClient = createPublicClient({
  chain: {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls,
    contracts: { multicall3: { address: MULTICALL3 } },
  },
  batch: { multicall: { wait: 16 } },
  transport: http(RPC_URL),
});

export async function GET(req: NextRequest) {
  // Public market data (used pre-login on the landing), so no auth — but rate
  // limit per IP so it can't be hammered to drive RPC cost.
  const limit = rateLimit(`prices:${clientIp(req)}`, 240, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    const prices = await priceAllWithFallback(publicClient);
    // Serialize to JSON-safe (numbers/null already are).
    const body = {
      prices,
      asOf: new Date().toISOString(),
    };
    return Response.json(body, {
      headers: {
        // Edge/browser cache 15s, allow 45s stale-while-revalidate.
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
      },
    });
  } catch (err) {
    return serverError("prices", err);
  }
}
