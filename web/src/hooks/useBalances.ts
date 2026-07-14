"use client";

// Money reads.
//
//   useUsdcBalance(address)   -> spendable dollars (USDG, 6dp; one batched RPC read)
//   usePortfolio(address)     -> fully-valued holdings from /api/portfolio
//
// The portfolio is computed SERVER-SIDE (one multicall + cached DEX-pool prices
// + real 1D market moves) and rendered verbatim here — the browser does no
// balance fan-out and no qty×price math. That keeps RPC traffic to ~one request
// per poll and makes every screen agree on the same numbers.
import { useCallback } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { ERC20_ABI } from "@/lib/abis";
import { USDG, STOCKS, ALL_ASSETS, type Asset } from "@/lib/tokens";
import { MONVERA } from "@/lib/monveraToken";
import { fromUnits } from "@/lib/format";
import { useDemo } from "@/components/demo/DemoProvider";

// Shared freshness policy for money reads: poll on a calm interval AND refetch
// when the user returns to the tab / reconnects / re-mounts a screen, so a
// deposit or action shows up without a manual page refresh. Writes invalidate
// immediately via useRefreshBalances, so the poll is only a safety net.
const LIVE_BALANCE_OPTS = {
  staleTime: 15_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  // `true` (not "always"): refetch on mount only when data is stale (>15s).
  // The LiteApp is a single-screen router and nine screens mount usePortfolio,
  // so "always" fired a fresh /api/portfolio on EVERY navigation, hammering the
  // endpoint. Writes still invalidate instantly via useRefreshBalances.
  refetchOnMount: true,
  // Keep the last value on screen across refetches / address changes, so the
  // balance never blanks out mid-update.
  placeholderData: keepPreviousData,
} as const;

export interface Holding {
  asset: Asset;
  raw: bigint;
  qty: number;
  /** USD value, or undefined if unpriced. */
  valueUsd?: number;
  priceUsd?: number;
  /** Real 1D market move (%), or undefined if no live source. */
  dayChangePct?: number;
  /** Real 1D sparkline for row charts. */
  spark?: number[];
  /** Shares from an RFQ fill still unwrapping (~1-15 min). Counted in totals,
      shown as "settling", NOT sellable (raw excludes them). */
  settlingQty?: number;
  settlingUsd?: number;
}

export interface Portfolio {
  holdings: Holding[];
  /** Sum of priced holdings (USD). */
  investedUsd: number;
  /** Spendable USDG (USD). */
  cashUsd: number;
  /** investedUsd + cashUsd — the headline number, computed server-side. */
  totalUsd: number;
}

/** Spendable USDG balance (number, dollars). */
export function useUsdcBalance(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["usdc-balance", address],
    enabled: !demo && Boolean(address),
    refetchInterval: 30_000,
    ...LIVE_BALANCE_OPTS,
    queryFn: async (): Promise<{ raw: bigint; value: number }> => {
      const raw = (await publicClient.readContract({
        address: USDG.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint;
      return { raw, value: fromUnits(raw, USDG.decimals) };
    },
  });
  if (demo) return { ...query, data: demo.usdc, isLoading: false, isPending: false } as typeof query;
  return query;
}

interface PortfolioApiHolding {
  symbol: string;
  raw: string;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
  spark: number[] | null;
  settlingQty?: number;
  settlingUsd?: number | null;
}

interface PortfolioApiResponse {
  cashUsd: number;
  investedUsd: number;
  totalUsd: number;
  holdings: PortfolioApiHolding[];
}

/** The user's holdings, valued server-side. See /api/portfolio. */
export function usePortfolio(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["portfolio", address],
    enabled: !demo && Boolean(address),
    refetchInterval: 30_000,
    ...LIVE_BALANCE_OPTS,
    queryFn: async (): Promise<Portfolio> => {
      const res = await fetch(`/api/portfolio?address=${address}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load portfolio.");
      }
      const api = json as PortfolioApiResponse;
      const holdings: Holding[] = [];
      for (const h of api.holdings) {
        const asset = h.symbol === "MONVERA" ? MONVERA_ASSET : ALL_ASSETS.find((a) => a.symbol === h.symbol);
        if (!asset) continue;
        holdings.push({
          asset,
          raw: BigInt(h.raw),
          qty: h.qty,
          valueUsd: h.valueUsd ?? undefined,
          priceUsd: h.priceUsd ?? undefined,
          dayChangePct: h.dayChangePct ?? undefined,
          spark: h.spark ?? undefined,
          settlingQty: h.settlingQty ?? undefined,
          settlingUsd: h.settlingUsd ?? undefined,
        });
      }
      return {
        holdings,
        investedUsd: api.investedUsd,
        cashUsd: api.cashUsd,
        totalUsd: api.totalUsd,
      };
    },
  });
  if (demo) return { ...query, data: demo.portfolio, isLoading: false, isPending: false } as typeof query;
  return query;
}

// $MONVERA appears in the portfolio like any holding, but it is NOT an Arcus
// asset: it trades only on the token screen (Uniswap route), never through the
// stock sell/trade flows. Callers that route to Arcus must skip this symbol.
const MONVERA_ASSET: Asset = {
  symbol: "MONVERA",
  name: "Monvera",
  tier: "stock",
  address: MONVERA.address,
  decimals: MONVERA.decimals,
};

/** True for the project token — held money, but not tradable via Arcus. */
export function isMonveraHolding(symbol: string): boolean {
  return symbol === "MONVERA";
}

/** True if `symbol` is a buyable stock-tier xStock (the only tier the executor routes today). */
export function isBuyableStock(symbol: string): boolean {
  return STOCKS.some((s) => s.symbol === symbol);
}

/**
 * Returns a function that invalidates the money queries (cash, portfolio,
 * activity) so they refetch immediately. Call it right after any successful
 * on-chain write — invest, buy/sell, send — so the UI reflects the new balance
 * without waiting for the poll interval or a manual page refresh.
 */
export function useRefreshBalances() {
  const qc = useQueryClient();
  return useCallback(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["usdc-balance"] });
      qc.invalidateQueries({ queryKey: ["monvera-balance"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    };
    invalidate();
    // The read RPC can trail the bundler by a block right after inclusion, so a
    // second pass a moment later catches the settled state.
    setTimeout(invalidate, 2500);
  }, [qc]);
}
