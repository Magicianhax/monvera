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
import { STAKING_ADDRESSES, stakingAbi } from "@/lib/staking";
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
  /** Shares held at the user's SMART ACCOUNT rather than their EOA — today that
      means bought through a Grove, since GroveManager keys positions on
      msg.sender and delivers there.

      Deliberately kept OUT of `raw`. Every sell path (SellScreen, OrderTicket,
      useSellAll) builds EOA-signed calldata straight from `raw`, so folding
      these in would offer shares for sale that the EOA cannot move and revert
      at signing time. Counted in the totals, because it is the user's money. */
  smartQty?: number;
  smartRaw?: string;
  smartUsd?: number | null;
  /** $MONVERA sitting in MonveraStaking, keyed on the EOA. Same rule as
      smartQty: the user's money, counted in totals, kept OUT of `raw` because
      it is not sellable until withdrawn. */
  stakedQty?: number;
  stakedRaw?: string;
  stakedUsd?: number | null;
  /** $MONVERA in the unstake cooldown (or withdrawable) — owned, on its way
      out, and NOT earning stake weight. Split from stakedQty because calling
      cooling tokens "staked" misstates what the user's stake is doing. */
  unstakingQty?: number;
  unstakingRaw?: string;
  unstakingUsd?: number | null;
  /** Unix seconds when the cooling unstake unlocks. Past = withdrawable NOW —
      the UI must say "ready to withdraw", not leave finished cooldowns
      labeled "unstaking" forever. */
  unstakeUnlockAt?: number;
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(`portfolio:${clientIp(req)}`, 240, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("Valid ?address required.");

  // Optional second address: the caller's ERC-4337 smart account. Grove buys
  // land there, so without it a user's basket is invisible and their total
  // reads low. Both addresses are public, and this route is read-only, so an
  // arbitrary value can only ever surface someone else's public balances.
  const smartParam = req.nextUrl.searchParams.get("smart");
  const smart =
    smartParam && isAddress(smartParam) && smartParam.toLowerCase() !== address.toLowerCase()
      ? (smartParam as `0x${string}`)
      : null;

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
        // $MONVERA — the project token is real money too.
        {
          address: MONVERA.address,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [address as `0x${string}`] as const,
        },
        // Same asset sweep against the smart account, appended so every index
        // above is unchanged. Same tick, so viem folds it into the one
        // Multicall3 call — a second address costs no extra RPC round trip.
        ...(smart
          ? assets.map((asset) => ({
              address: asset.address!,
              abi: ERC20_ABI,
              functionName: "balanceOf" as const,
              args: [smart] as const,
            }))
          : []),
        // USDG parked at the smart account. Grove exits pay proceeds to
        // msg.sender — the smart account — and no flow sweeps them back to the
        // EOA, so without this read a user who exits a Grove watches that cash
        // vanish from every screen.
        ...(smart
          ? [{
              address: USDG.address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "balanceOf" as const,
              args: [smart] as const,
            }]
          : []),
        // $MONVERA at the smart account: Matcha-routed token buys pay the smart
        // account and sweep only minOut home, so the slippage remainder parks
        // here — real money that was invisible to every screen.
        ...(smart
          ? [{
              address: MONVERA.address,
              abi: ERC20_ABI,
              functionName: "balanceOf" as const,
              args: [smart] as const,
            }]
          : []),
        // $MONVERA in the staking contract (stakedOf) plus any cooling unstake
        // (pendingOf) — both keyed on the EOA, both still the user's tokens.
        {
          address: STAKING_ADDRESSES.staking,
          abi: stakingAbi,
          functionName: "stakedOf" as const,
          args: [address as `0x${string}`] as const,
        },
        {
          address: STAKING_ADDRESSES.staking,
          abi: stakingAbi,
          functionName: "pendingOf" as const,
          args: [address as `0x${string}`] as const,
        },
      ],
    });

    // Explicit offsets — the layout is positional and there are now six
    // sections, so "last slot" arithmetic is no longer safe.
    const IDX_ASSETS = 1;
    const IDX_WRAPPERS = IDX_ASSETS + assets.length;
    const IDX_MONVERA = IDX_WRAPPERS + wrapperEntries.length;
    const IDX_SMART = IDX_MONVERA + 1;
    const IDX_SMART_USDG = IDX_SMART + (smart ? assets.length : 0);
    const IDX_SMART_MONVERA = IDX_SMART_USDG + (smart ? 1 : 0);
    const IDX_STAKED = IDX_SMART_MONVERA + (smart ? 1 : 0);
    const IDX_PENDING = IDX_STAKED + 1;

    const usdcRead = results[0];
    const cashUsd =
      usdcRead.status === "success" ? fromUnits(usdcRead.result as bigint, USDG.decimals) : 0;

    // Grove-exit proceeds parked at the smart account. Reported separately from
    // cashUsd because the ordinary buy flows spend from the EOA — this is the
    // user's cash, but not what a buy can pull today.
    const smartUsdgRead = smart ? results[IDX_SMART_USDG] : null;
    const smartCashUsd =
      smartUsdgRead && smartUsdgRead.status === "success"
        ? fromUnits(smartUsdgRead.result as bigint, USDG.decimals)
        : 0;

    // Staked and cooling $MONVERA, kept apart: "staked" earns weight, a
    // cooling unstake doesn't — folding them together misstates the stake.
    // Both reads are best-effort: a staking-contract hiccup must never blank
    // the rest of the portfolio.
    const stakedRead = results[IDX_STAKED];
    const pendingRead = results[IDX_PENDING];
    const stakedRaw = stakedRead.status === "success" ? (stakedRead.result as bigint) : BigInt(0);
    const unstakingRaw =
      pendingRead.status === "success" ? (pendingRead.result as readonly [bigint, bigint])[0] : BigInt(0);
    // The unlock timestamp travels with the amount — throwing it away left
    // finished cooldowns labeled "unstaking" forever.
    const unstakeUnlockAt =
      pendingRead.status === "success" ? Number((pendingRead.result as readonly [bigint, bigint])[1]) : 0;

    // Matcha-buy remainder parked at the smart account.
    const smartMonveraRead = smart ? results[IDX_SMART_MONVERA] : null;
    const smartMonveraRaw =
      smartMonveraRead && smartMonveraRead.status === "success" ? (smartMonveraRead.result as bigint) : BigInt(0);

    // Settling (wrapped) balance per asset index. Wrappers are 1:1 and share the
    // underlying's decimals.
    const settlingByAsset = new Map<number, bigint>();
    for (let i = 0; i < wrapperEntries.length; i++) {
      const r = results[IDX_WRAPPERS + i];
      if (r.status === "success" && (r.result as bigint) !== BigInt(0)) {
        const idx = wrapperEntries[i].assetIdx;
        settlingByAsset.set(idx, (settlingByAsset.get(idx) ?? BigInt(0)) + (r.result as bigint));
      }
    }

    // Balances sitting at the smart account (Grove-bought shares).
    const smartByAsset = new Map<number, bigint>();
    if (smart) {
      for (let i = 0; i < assets.length; i++) {
        const r = results[IDX_SMART + i];
        if (r.status === "success" && (r.result as bigint) !== BigInt(0)) {
          smartByAsset.set(i, r.result as bigint);
        }
      }
    }

    // 2. Held tokens only — settled, still settling, or held in the smart
    //    account. All three are the user's money.
    const heldIdx: number[] = [];
    for (let i = 0; i < assets.length; i++) {
      const r = results[IDX_ASSETS + i];
      const held = r.status === "success" && (r.result as bigint) !== BigInt(0);
      if (held || settlingByAsset.has(i) || smartByAsset.has(i)) heldIdx.push(i);
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
      const r = results[IDX_ASSETS + i];
      const raw = r.status === "success" ? (r.result as bigint) : BigInt(0);
      const asset = assets[i];
      const qty = fromUnits(raw, asset.decimals!);
      const priceUsd = prices[asset.symbol]?.priceUsd ?? null;
      const settlingRaw = settlingByAsset.get(i);
      const settlingQty = settlingRaw ? fromUnits(settlingRaw, asset.decimals!) : 0;
      const smartRaw = smartByAsset.get(i);
      const smartQty = smartRaw ? fromUnits(smartRaw, asset.decimals!) : 0;
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
        ...(smartQty > 0
          ? { smartQty, smartRaw: smartRaw!.toString(), smartUsd: priceUsd !== null ? smartQty * priceUsd : null }
          : {}),
      });
    }

    // $MONVERA — priced off its DEX pool (GeckoTerminal, cached), 1D move from
    // the same source. No spark series exists for it; the row shows without one.
    // The row also exists when everything is staked (wallet zero): staked
    // tokens are still the user's money and must not disappear from the list.
    const monveraRead = results[IDX_MONVERA];
    const monveraRaw = monveraRead.status === "success" ? (monveraRead.result as bigint) : BigInt(0);
    if (monveraRaw > BigInt(0) || stakedRaw > BigInt(0) || unstakingRaw > BigInt(0) || smartMonveraRaw > BigInt(0)) {
      const spot = await getMonveraSpot();
      const qty = fromUnits(monveraRaw, MONVERA.decimals);
      const stakedQty = fromUnits(stakedRaw, MONVERA.decimals);
      const unstakingQty = fromUnits(unstakingRaw, MONVERA.decimals);
      const smartQty = fromUnits(smartMonveraRaw, MONVERA.decimals);
      holdings.push({
        symbol: "MONVERA",
        raw: monveraRaw.toString(),
        qty,
        priceUsd: spot?.priceUsd ?? null,
        valueUsd: spot ? qty * spot.priceUsd : null,
        dayChangePct: spot?.change24h ?? null,
        spark: null,
        ...(stakedQty > 0
          ? { stakedQty, stakedRaw: stakedRaw.toString(), stakedUsd: spot ? stakedQty * spot.priceUsd : null }
          : {}),
        ...(unstakingQty > 0
          ? { unstakingQty, unstakingRaw: unstakingRaw.toString(), unstakingUsd: spot ? unstakingQty * spot.priceUsd : null, unstakeUnlockAt }
          : {}),
        ...(smartQty > 0
          ? { smartQty, smartRaw: smartMonveraRaw.toString(), smartUsd: spot ? smartQty * spot.priceUsd : null }
          : {}),
      });
    }

    // Largest value first (settled + settling + smart-account + staked +
    // unstaking), unpriced last.
    const worth = (h: PortfolioHolding) =>
      (h.valueUsd ?? 0) + (h.settlingUsd ?? 0) + (h.smartUsd ?? 0) + (h.stakedUsd ?? 0) + (h.unstakingUsd ?? 0);
    holdings.sort((a, b) => worth(b) - worth(a));
    // Smart-account shares and staked tokens count toward what the user owns
    // even though they are not sellable from the EOA. Leaving them out would
    // show a total lower than the user's actual money the moment they buy a
    // Grove or stake.
    const investedUsd = holdings.reduce((s, h) => s + worth(h), 0);

    return Response.json(
      {
        cashUsd,
        smartCashUsd,
        investedUsd,
        totalUsd: cashUsd + smartCashUsd + investedUsd,
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
