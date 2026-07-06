"use client";

// useTransactions — a wallet's incoming + outgoing transfer history from
// /api/transactions (Alchemy + on-chain fallback). Refreshes on focus and on a
// short interval, like the balance hooks, so new transfers show without a manual
// refresh. Inert in demo mode.
import { useQuery } from "@tanstack/react-query";
import { useDemo } from "@/components/demo/DemoProvider";
import type { WalletTx } from "@/lib/walletTx";

async function fetchTransactions(address: string): Promise<WalletTx[]> {
  const res = await fetch(`/api/transactions?address=${address}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load transactions.");
  }
  return (json.transactions ?? []) as WalletTx[];
}

export function useTransactions(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["transactions", address],
    enabled: !demo && Boolean(address),
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: () => fetchTransactions(address as string),
  });
  if (demo) return { ...query, data: [] as WalletTx[], isLoading: false, isPending: false } as typeof query;
  return query;
}
