"use client";

// useGroves — client data for the IN-APP Groves pages, straight from the same
// public /api/groves endpoints the site pages and DefiLlama-class trackers
// read. No duplicate registry logic: types come from the server assembly
// (type-only import — erased at compile time, so "server-only" never executes).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GroveLive, GrovesPayload } from "@/lib/server/groveService";

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

export type { GroveLive, GrovesPayload };
