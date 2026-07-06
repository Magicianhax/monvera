"use client";

// usePrices — live USD spot for every asset, from /api/prices (DEX-pool reads,
// cached server-side). Use `usePrice(symbol)` for a single headline price.
//
// The returned price is the REAL on-chain spot (Fluxion for stocks, Agni route
// for sUSDe/mETH). Assets with no live source return undefined — callers should
// fall back honestly (e.g. show the indicative reference or a dash), never fake.
import { useQuery } from "@tanstack/react-query";
import type { AssetPrice } from "@/lib/prices";

export interface PricesResponse {
  prices: Record<string, AssetPrice>;
  asOf: string;
}

export async function fetchPrices(): Promise<PricesResponse> {
  const res = await fetch("/api/prices");
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load prices.");
  }
  return json as PricesResponse;
}

/** All live asset prices (symbol -> AssetPrice). Refreshes every 30s. */
export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: fetchPrices,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

/** Convenience: the live USD price for one symbol (undefined while loading / no source). */
export function usePrice(symbol: string | undefined): { priceUsd?: number; isLoading: boolean } {
  const { data, isLoading } = usePrices();
  if (!symbol) return { priceUsd: undefined, isLoading };
  return { priceUsd: data?.prices[symbol]?.priceUsd, isLoading };
}
