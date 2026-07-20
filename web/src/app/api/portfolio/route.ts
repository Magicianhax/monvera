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
import { getMonveraSpot } from "@/lib/server/monveraPrice";
import { MONVERA } from "@/lib/monveraToken";
import { getWrapperEntries } from "@/lib/server/wrapperMap";
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

interface PortfolioHolding {
  symbol: string;
  /** Raw balance as a decimal string (bigint-safe for JSON). Settled shares only. */
  raw: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
  spark: number[] | null;
  /** Wrapped shares from an RFQ fill still unwrapping (~1-15 min). Counted in the
      totals so the money never looks gone, but not sellable until settled. */
  settlingQty?: number;
  settlingUsd?: number | null;
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(`portfolio:${clientIp(req)}`, 240, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("Valid ?address required.");

  try {
    const assets = ALL_ASSETS.filter((a) => a.address && a.decimals);

    // The day summary is universe-wide + cached 5 min, so kick it off in
    // parallel. Day change is decorative, so a cold Yahoo sweep must not hold
    // the whole portfolio hostage: cap the wait at 3.5s and let it fill in on
    // the next poll (by then the 5-min cache is warm).
    const empty = {} as Awaited<ReturnType<typeof getDaySummary>>;
    const dayP = Promise.race([
      getDaySummary().catch(() => empty),
      new Promise<Awaited<ReturnType<typeof getDaySummary>>>((resolve) => setTimeout(() => resolve(empty), 3_500)),
    ]);

    // Known RFQ wrapper tokens (wXLK, wSOXX, …): a fill sits at the wrapper's
    // address for ~1-15 min before unwrapping, and must still count as the
    // user's money. Map each wrapper to its asset index so its balance lands on
    // the right holding as "settling".
    const wrapperEntries = (await getWrapperEntries())
      .map((w) => ({
        wrapper: w.wrapper,
        assetIdx: assets.findIndex((a) => a.address && a.address.toLowerCase() === w.underlying.toLowerCase()),
      }))
      .filter((w) => w.assetIdx >= 0);

    // 1. Balances first — one multicall, one RPC request. We need these to know
    //    which tokens to price (pricing the whole 95-token universe, with its
    //    2s Arcus sweep, was the portfolio's cold-load cost — a user only holds
    //    a handful, mostly Chainlink-fed).
    const results = await publicClient.multicall({
      contracts: [
        { address: USDG.address as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address as `0x${string}`] },
        ...assets.map((asset) => ({
          address: asset.address!,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [address as `0x${string}`] as const,
        })),
        ...wrapperEntries.map((w) => ({
          address: w.wrapper,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [address as `0x${string}`] as const,
        })),
        // $MONVERA — the project token is real money too; last slot in the call.
        {
          address: MONVERA.address,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [address as `0x${string}`] as const,
        },
      ],
    });

    const usdcRead = results[0];
    const cashUsd =
      usdcRead.status === "success" ? fromUnits(usdcRead.result as bigint, USDG.decimals) : 0;

    // Settling (wrapped) balance per asset index. Wrappers are 1:1 and share the
    // underlying's decimals.
    const settlingByAsset = new Map<number, bigint>();
    for (let i = 0; i < wrapperEntries.length; i++) {
      const r = results[1 + assets.length + i];
      if (r.status === "success" && (r.result as bigint) !== BigInt(0)) {
        const idx = wrapperEntries[i].assetIdx;
        settlingByAsset.set(idx, (settlingByAsset.get(idx) ?? BigInt(0)) + (r.result as bigint));
      }
    }

    // 2. Held tokens only — settled OR still settling (both are the user's money).
    const heldIdx: number[] = [];
    for (let i = 0; i < assets.length; i++) {
      const r = results[i + 1];
      const held = r.status === "success" && (r.result as bigint) !== BigInt(0);
      if (held || settlingByAsset.has(i)) heldIdx.push(i);
    }
    const heldAssets = heldIdx.map((i) => assets[i]);

    // 3. Price ONLY the held tokens (best-effort — a price blip must not 500
    //    the whole portfolio; balances are the real answer). Await the day
    //    summary alongside.
    const [prices, day] = await Promise.all([
      heldAssets.length > 0
        ? priceAllWithFallback(publicClient, heldAssets).catch(() => ({}) as Awaited<ReturnType<typeof priceAllWithFallback>>)
        : Promise.resolve({} as Awaited<ReturnType<typeof priceAllWithFallback>>),
      dayP,
    ]);

    const holdings: PortfolioHolding[] = [];
    for (const i of heldIdx) {
      const r = results[i + 1];
      const raw = r.status === "success" ? (r.result as bigint) : BigInt(0);
      const asset = assets[i];
      const qty = fromUnits(raw, asset.decimals!);
      const priceUsd = prices[asset.symbol]?.priceUsd ?? null;
      const settlingRaw = settlingByAsset.get(i);
      const settlingQty = settlingRaw ? fromUnits(settlingRaw, asset.decimals!) : 0;
      holdings.push({
        symbol: asset.symbol,
        raw: raw.toString(),
        qty,
        priceUsd,
        valueUsd: priceUsd !== null ? qty * priceUsd : null,
        dayChangePct: day[asset.symbol]?.dayChangePct ?? null,
        spark: day[asset.symbol]?.spark ?? null,
        ...(settlingQty > 0
          ? { settlingQty, settlingUsd: priceUsd !== null ? settlingQty * priceUsd : null }
          : {}),
      });
    }

    // $MONVERA — priced off its DEX pool (GeckoTerminal, cached), 1D move from
    // the same source. No spark series exists for it; the row shows without one.
    const monveraRead = results[results.length - 1];
    const monveraRaw = monveraRead.status === "success" ? (monveraRead.result as bigint) : BigInt(0);
    if (monveraRaw > BigInt(0)) {
      const spot = await getMonveraSpot();
      const qty = fromUnits(monveraRaw, MONVERA.decimals);
      holdings.push({
        symbol: "MONVERA",
        raw: monveraRaw.toString(),
        qty,
        priceUsd: spot?.priceUsd ?? null,
        valueUsd: spot ? qty * spot.priceUsd : null,
        dayChangePct: spot?.change24h ?? null,
        spark: null,
      });
    }

    // Largest value first (settled + settling), unpriced last.
    holdings.sort(
      (a, b) => ((b.valueUsd ?? 0) + (b.settlingUsd ?? 0)) - ((a.valueUsd ?? 0) + (a.settlingUsd ?? 0)),
    );
    const investedUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0) + (h.settlingUsd ?? 0), 0);

    return Response.json(
      {
        cashUsd,
        investedUsd,
        totalUsd: cashUsd + investedUsd,
        holdings,
        asOf: new Date().toISOString(),
      },
      // Short edge cache: long enough to absorb bursts, short enough that a
      // refreshBalances() fired when an RFQ fill unwraps sees the new balance
      // instead of a stale edge copy.
      { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } },
    );
  } catch (err) {
    return serverError("portfolio", err);
  }
}
