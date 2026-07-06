"use client";

// usePortfolioHistory — the portfolio's total value over a chosen range (1D…All).
// Fetches each holding's real price history for the range (/api/market, cached),
// scales it to the holding's current value, sums, and adds cash as a flat line.
// One combined value curve, so the Owned chart can offer time ranges like a
// real brokerage. Honest: market value of what you hold now, not cost-basis PnL.
import { useQuery } from "@tanstack/react-query";
import type { MarketRange } from "./useMarket";
import { combinePortfolioCurve, type DayCurve } from "@/lib/portfolioCurve";

interface CurveHolding {
  symbol: string;
  valueUsd?: number;
}

export function usePortfolioHistory(holdings: CurveHolding[], cash: number, range: MarketRange) {
  const priced = holdings.filter((h) => (h.valueUsd ?? 0) > 0);
  // Key on the priced set + cash so it refetches when holdings/values change.
  const key = priced.map((h) => `${h.symbol}:${Math.round((h.valueUsd ?? 0) * 100)}`).join(",");

  return useQuery({
    queryKey: ["portfolio-history", key, Math.round(cash * 100), range],
    enabled: priced.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<DayCurve | null> => {
      const parts = await Promise.all(
        priced.map(async (h) => {
          try {
            const res = await fetch(`/api/market?symbol=${h.symbol}&range=${range}`);
            const json = (await res.json()) as { series?: number[] | null };
            return { valueUsd: h.valueUsd ?? 0, series: json.series ?? undefined };
          } catch {
            return { valueUsd: h.valueUsd ?? 0, series: undefined };
          }
        }),
      );
      return combinePortfolioCurve(parts, cash);
    },
  });
}
