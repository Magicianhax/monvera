"use client";

// useMarket — REAL price history from /api/market (Yahoo Finance for the
// equities our xStocks track, CoinGecko for the token tier; cached server-side).
//
//   useMarketHistory(symbol, range) -> { series, changePct } for the detail chart
//   useMarketSummary()              -> 1D change + spark per symbol (market rows)
//
// series/changePct are null when the asset has no live source or the upstream
// is down — callers fall back to the presentational reference, never blank.
import { useQuery, keepPreviousData } from "@tanstack/react-query";

export type MarketRange = "1D" | "1W" | "1M" | "1Y" | "All";

export interface MarketMeta {
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  exchange?: string;
}

export interface MarketHistoryResponse {
  series: number[] | null;
  timestamps: number[] | null;
  changePct: number | null;
  meta: MarketMeta | null;
  asOf: string;
}

export interface MarketSummaryResponse {
  summary: Record<string, { dayChangePct: number; spark: number[] }>;
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

export interface TradabilityResponse {
  /** Two-way tradable symbols (buy AND sell routes live). null = no sweep yet — treat as unknown, hide nothing. */
  ok: string[] | null;
  dropped: string[];
  asOf: string | null;
}

/** The two-way tradable universe from the hourly venue sweep. Fail-open. */
export function useTradability() {
  return useQuery({
    queryKey: ["tradability"],
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: () => getJson<TradabilityResponse>("/api/tradability", "Couldn't check tradability."),
  });
}

/** Real chart series for one asset + range. keepPreviousData makes range switches seamless. */
export function useMarketHistory(symbol: string | undefined, range: MarketRange) {
  return useQuery({
    queryKey: ["market-history", symbol, range],
    enabled: Boolean(symbol),
    staleTime: 60_000,
    // The headline price beside the chart ticks every poll — a chart frozen at
    // mount while the number moves reads as broken. One minute matches the
    // server cache, so this adds no upstream load.
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () =>
      getJson<MarketHistoryResponse>(
        `/api/market?symbol=${symbol}&range=${range}`,
        "Couldn't load the chart.",
      ),
  });
}

/** Real 1D change + sparkline for every asset (market list rows). */
export function useMarketSummary() {
  return useQuery({
    queryKey: ["market-summary"],
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: () =>
      getJson<MarketSummaryResponse>("/api/market", "Couldn't load market data."),
  });
}
