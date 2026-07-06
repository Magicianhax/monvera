"use client";

// useActivity — a user's REAL Monvera on-chain history (AI invests via the executor),
// newest first, with Mantlescan links. Powers the activity/receipts UI.
//
// Fetched via /api/activity (Etherscan-indexed, server-cached): the browser
// can't eth_getLogs the full deploy→latest range against the public RPC (its
// 10k-block range cap made the old direct scan fail and show no history).
import { useQuery } from "@tanstack/react-query";
import type { ActivityRow } from "@/lib/onchainHistory";
import { useDemo } from "@/components/demo/DemoProvider";

export type { ActivityRow };

export function useActivity(address?: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["activity", address],
    enabled: !demo && Boolean(address),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<ActivityRow[]> => {
      const res = await fetch(`/api/activity?address=${address}`);
      if (!res.ok) throw new Error(`activity failed: ${res.status}`);
      const json = (await res.json()) as {
        activity: (Omit<ActivityRow, "blockNumber"> & { blockNumber: number })[];
      };
      return json.activity.map((a) => ({ ...a, blockNumber: BigInt(a.blockNumber) }));
    },
  });
  if (demo) return { ...query, data: demo.activity, isLoading: false, isPending: false } as typeof query;
  return query;
}
