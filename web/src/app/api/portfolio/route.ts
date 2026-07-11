// GET /api/portfolio?address=0x… — the user's holdings, fully valued on the
// server. ONE multicall reads USDG + every asset balance, prices come from the
// same DEX-pool spot source as /api/prices (cached 15s across all users), and
// each holding is decorated with its real 1D market move for the row UI.
//
// The client renders this verbatim — no balance fan-out, no qty×price math, no
// price stitching on the frontend.
import type { NextRequest } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { MULTICALL3, USDG, ALL_ASSETS } from "@/lib/tokens";
import { chain } from "@/lib/chain";
import { ERC20_ABI } from "@/lib/abis";
import { priceAllWithFallback } from "@/lib/server/pricing";
import { fromUnits } from "@/lib/format";
import { getDaySummary } from "@/lib/server/marketData";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

import { SERVER_RPC_URL } from "@/lib/server/rpc";

const RPC_URL = SERVER_RPC_URL;

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

// Prices move slowly relative to page views — share one read across all users.
// Goes through priceAllWithFallback so a holding in an Arcus-only stock (most of
// them) shows a real value instead of a dash on the portfolio and sell screens.
let pricesCache: { at: number; value: ReturnType<typeof priceAllWithFallback> } | null = null;
function cachedPrices() {
  if (pricesCache && Date.now() - pricesCache.at < 15_000) return pricesCache.value;
  const value = priceAllWithFallback(publicClient).catch((err) => {
    pricesCache = null;
    throw err;
  });
  pricesCache = { at: Date.now(), value };
  return value;
}

interface PortfolioHolding {
  symbol: string;
  /** Raw balance as a decimal string (bigint-safe for JSON). */
  raw: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
  spark: number[] | null;
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(`portfolio:${clientIp(req)}`, 240, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("Valid ?address required.");

  try {
    const assets = ALL_ASSETS.filter((a) => a.address && a.decimals);
    const [results, prices, day] = await Promise.all([
      // USDG first, then the asset universe — one multicall, one RPC request.
      publicClient.multicall({
        contracts: [
          { address: USDG.address as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address as `0x${string}`] },
          ...assets.map((asset) => ({
            address: asset.address!,
            abi: ERC20_ABI,
            functionName: "balanceOf" as const,
            args: [address as `0x${string}`] as const,
          })),
        ],
      }),
      cachedPrices(),
      getDaySummary().catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
    ]);

    const usdcRead = results[0];
    const cashUsd =
      usdcRead.status === "success" ? fromUnits(usdcRead.result as bigint, USDG.decimals) : 0;

    const holdings: PortfolioHolding[] = [];
    for (let i = 0; i < assets.length; i++) {
      const r = results[i + 1];
      if (r.status !== "success") continue; // one bad token never hides the rest
      const raw = r.result as bigint;
      if (raw === BigInt(0)) continue;
      const asset = assets[i];
      const qty = fromUnits(raw, asset.decimals!);
      const priceUsd = prices[asset.symbol]?.priceUsd ?? null;
      holdings.push({
        symbol: asset.symbol,
        raw: raw.toString(),
        qty,
        priceUsd,
        valueUsd: priceUsd !== null ? qty * priceUsd : null,
        dayChangePct: day[asset.symbol]?.dayChangePct ?? null,
        spark: day[asset.symbol]?.spark ?? null,
      });
    }

    // Largest value first, unpriced last.
    holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    const investedUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

    return Response.json(
      {
        cashUsd,
        investedUsd,
        totalUsd: cashUsd + investedUsd,
        holdings,
        asOf: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return serverError("portfolio", err);
  }
}
