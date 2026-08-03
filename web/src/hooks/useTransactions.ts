"use client";

// useTransactions — a user's incoming + outgoing transfer history from
// /api/transactions (Alchemy + on-chain fallback). Refreshes on focus and on a
// short interval, like the balance hooks, so new transfers show without a manual
// refresh. Inert in demo mode.
//
// The smart account is resolved HERE (like usePortfolio does) so every caller
// picks up grove buys/exits — which execute at the smart account — without
// changing a single call site.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useDemo } from "@/components/demo/DemoProvider";
import { useSmartAccountResolution } from "@/hooks/useSmartAccountAddress";
import type { WalletTx } from "@/lib/walletTx";

async function fetchTransactions(address: string, smart?: string): Promise<WalletTx[]> {
  const res = await fetch(`/api/transactions?address=${address}${smart ? `&smart=${smart}` : ""}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load transactions.");
  }
  return (json.transactions ?? []) as WalletTx[];
}

export function useTransactions(address?: string) {
  const demo = useDemo();
  // Same rule as usePortfolio: wait the few ms for the smart address so the
  // first fetch already covers both accounts instead of fetching twice.
  const { address: smart, resolving } = useSmartAccountResolution();
  const query = useQuery({
    queryKey: ["transactions", address, smart],
    enabled: !demo && Boolean(address) && !resolving,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // The smart address resolves async and flips the key once — keep the
    // EOA-only list on screen instead of blanking the feed for that beat.
    placeholderData: keepPreviousData,
    queryFn: () => fetchTransactions(address as string, smart),
  });
  if (demo) return { ...query, data: [] as WalletTx[], isLoading: false, isPending: false } as typeof query;
  return query;
}
