"use client";

// useGroves — client data for the IN-APP Groves pages, straight from the same
// public /api/groves endpoints the site pages and DefiLlama-class trackers
// read. No duplicate registry logic: types come from the server assembly
// (type-only import — erased at compile time, so "server-only" never executes).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GroveLive, GrovesPayload } from "@/lib/server/groveService";
import type { GroveHistory } from "@/lib/server/groveHistory";
import type { GroveCheckRow } from "@/lib/server/groveChecks";

interface GroveChecks {
  rows: GroveCheckRow[];
  asOf: string;
}

async function getJson<T>(url: string, fallbackError: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : fallbackError);
  }
  return json as T;
}

/** The full Grove book: defs + live prices + stats + 1Y backtests (server-cached ~60s). */
export function useGrovesList() {
  return useQuery({
    queryKey: ["groves"],
    staleTime: 60_000,
    queryFn: () => getJson<GrovesPayload>("/api/groves", "Couldn't load the Groves."),
  });
}

/** One Grove with live data. Paints instantly from the shelf's cache when warm. */
export function useGroveLive(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["grove", id],
    enabled: !!id,
    staleTime: 60_000,
    placeholderData: () =>
      qc.getQueryData<GrovesPayload>(["groves"])?.groves.find((g) => g.id === id),
    queryFn: () => getJson<GroveLive>(`/api/groves/${id}`, "Couldn't load this Grove."),
  });
}

/** Every on-chain touch of a grove — member rebalances + recipe changes,
 *  newest first. Empty is the honest launch state, so it renders, not hides. */
export function useGroveHistory(id: string | null) {
  return useQuery({
    queryKey: ["grove-history", id],
    enabled: !!id,
    staleTime: 120_000,
    queryFn: () => getJson<GroveHistory>(`/api/groves/${id}/history`, "Couldn't load this grove's history."),
  });
}

/** This holder's own record of every window Vera checked their basket in,
 *  including the ones that correctly traded nothing. The chain shows only
 *  rebalances that happened, so without this a well-managed basket and an
 *  unmanaged one look identical. */
export function useGroveChecks(id: string | null, address: string | null) {
  return useQuery({
    queryKey: ["grove-checks", id, address],
    enabled: !!id && !!address,
    staleTime: 30_000,
    queryFn: () =>
      getJson<GroveChecks>(
        `/api/groves/${id}/checks?address=${address}`,
        "Couldn't load this basket's check history.",
      ),
  });
}

export type { GroveLive, GrovesPayload, GroveHistory, GroveChecks };
