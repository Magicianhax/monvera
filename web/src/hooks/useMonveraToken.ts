"use client";

// $MONVERA reads: live price/stats (via /api/token-price) and the holder gate.
// The gate is a plain balanceOf on the user's EOA — 100k MONVERA unlocks holder
// features (Scan to Buy in Phase B). Refreshed after in-app buys/sells via
// useRefreshBalances (which invalidates "monvera-balance").
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { publicClient } from "@/lib/wagmi";
import { MONVERA, HOLDER_THRESHOLD, ERC20_MINI_ABI } from "@/lib/monveraToken";

export interface TokenPrice {
  priceUsd: number;
  change24h: number;
  marketCap: number;
  liquidityUsd: number;
  volume24h: number;
  asOf: string;
}

/** Live $MONVERA price/stats. Public — also used pre-login on the Home pill. */
export function useMonveraPrice() {
  return useQuery({
    queryKey: ["monvera-price"],
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<TokenPrice> => {
      const res = await fetch("/api/token-price");
      if (!res.ok) throw new Error("Couldn't load $MONVERA price.");
      return (await res.json()) as TokenPrice;
    },
  });
}

export type TokenChartRange = "1D" | "1W" | "1M" | "1Y" | "All";
export interface TokenChart {
  series: number[];
  changePct: number | null;
  asOf: string;
}

/** $MONVERA price history for the native PriceChart (GeckoTerminal OHLCV). */
export function useMonveraChart(range: TokenChartRange) {
  return useQuery({
    queryKey: ["monvera-chart", range],
    refetchInterval: 120_000,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<TokenChart> => {
      const res = await fetch(`/api/token-chart?range=${range}`);
      if (!res.ok) throw new Error("Couldn't load the $MONVERA chart.");
      return (await res.json()) as TokenChart;
    },
  });
}

/** The 100k-MONVERA holder gate, read from the user's EOA. */
export function useMonveraGate(address?: string) {
  const query = useQuery({
    queryKey: ["monvera-balance", address],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<bigint> =>
      (await publicClient.readContract({
        address: MONVERA.address,
        abi: ERC20_MINI_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint,
  });
  const balance = query.data ?? BigInt(0);
  return {
    isHolder: balance >= HOLDER_THRESHOLD,
    balance,
    required: HOLDER_THRESHOLD,
    /** 0..1 toward the gate, for the unlock progress bar. */
    progress: Math.min(1, Number((balance * BigInt(1000)) / HOLDER_THRESHOLD) / 1000),
    isLoading: query.isLoading,
  };
}
