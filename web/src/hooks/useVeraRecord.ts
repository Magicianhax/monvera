"use client";

// useVeraRecord — Vera's REAL on-chain track record from the StaxExecutor log,
// plus her IdentityRegistry reputation score. Replaces the sample track record on
// the Vera screen. Global by default; pass an address to scope to one user.
//
// Fetched via /api/vera-record (Etherscan-indexed, server-cached): the browser
// can't eth_getLogs the full deploy→latest range against the public RPC — its
// 10k-block range cap made the old direct scan fail and read as zeros.
// Returns a clean 0-state on empty history (no faked numbers).
import { useQuery } from "@tanstack/react-query";
import type { VeraRecord } from "@/lib/onchainHistory";
import { useDemo } from "@/components/demo/DemoProvider";

export interface VeraRecordData extends VeraRecord {
  reputation?: bigint;
}

interface ApiRecord extends Omit<VeraRecord, "recentRecommendations"> {
  recentRecommendations: (Omit<VeraRecord["recentRecommendations"][number], "blockNumber"> & {
    blockNumber: number;
  })[];
}

export function useVeraRecord(user?: `0x${string}`) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["vera-record", user ?? "global"],
    enabled: !demo,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<VeraRecordData> => {
      const qs = user ? `?user=${user}` : "";
      const res = await fetch(`/api/vera-record${qs}`);
      if (!res.ok) throw new Error(`vera-record failed: ${res.status}`);
      const json = (await res.json()) as { record: ApiRecord; reputation: string | null };
      return {
        ...json.record,
        recentRecommendations: json.record.recentRecommendations.map((r) => ({
          ...r,
          blockNumber: BigInt(r.blockNumber),
        })),
        reputation: json.reputation === null ? undefined : BigInt(json.reputation),
      };
    },
  });
  if (demo) return { ...query, data: demo.veraRecord, isLoading: false, isPending: false } as typeof query;
  return query;
}
