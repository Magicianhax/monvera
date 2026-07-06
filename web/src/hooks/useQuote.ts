"use client";

// Pre-trade "you'll get X" quote for the manual buy/sell panel, via 0x RFQ.
// Buy quotes USDG (6dp) -> stock (18dp); sell quotes stock -> USDG. The 0x API key
// lives server-side, so this calls our /api/quote route (mode: "price").
import { useQuery } from "@tanstack/react-query";
import { authHeader } from "@/lib/authedFetch";
import { USDG, type Asset } from "@/lib/tokens";
import { fromUnits } from "@/lib/format";

// Indicative price checks don't spend a balance, so a placeholder taker is fine
// when the caller hasn't passed the user's smart-account address yet.
const PLACEHOLDER_TAKER = "0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7";

async function priceOut(
  side: "buy" | "sell",
  symbol: string,
  sellAmount: bigint,
  taker: string,
): Promise<bigint> {
  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ mode: "price", side, symbol, sellAmount: sellAmount.toString(), taker }),
  });
  const json = (await res.json()) as { liquidityAvailable?: boolean; buyAmount?: string };
  if (!res.ok || !json.liquidityAvailable || !json.buyAmount) return BigInt(0);
  return BigInt(json.buyAmount);
}

export interface Quote {
  amountInRaw: bigint; // USDG, 6dp
  expectedOutRaw: bigint; // tokenOut, asset.decimals
  expectedOutQty: number;
  pricePerToken: number; // USD per whole token
}

/** Quote `amountUsd` of USDG into `asset` via 0x. Returns null while disabled/loading. */
export function useQuote(asset: Asset | null, amountUsd: number, taker?: string) {
  const enabled = Boolean(asset && amountUsd > 0);
  return useQuery({
    queryKey: ["quote", asset?.symbol, Math.round(amountUsd * 100)],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Quote> => {
      const a = asset!;
      const amountInRaw = BigInt(Math.round(amountUsd * 1_000_000));
      const expectedOutRaw = await priceOut("buy", a.symbol, amountInRaw, taker ?? PLACEHOLDER_TAKER);
      const expectedOutQty = fromUnits(expectedOutRaw, a.decimals);
      const pricePerToken = expectedOutQty > 0 ? amountUsd / expectedOutQty : 0;
      return { amountInRaw, expectedOutRaw, expectedOutQty, pricePerToken };
    },
  });
}

export interface SellQuote {
  amountInRaw: bigint; // token, asset.decimals
  expectedUsdcRaw: bigint; // USDG, 6dp
  expectedUsd: number;
}

/** Quote selling `tokenQtyRaw` raw units of `asset` into USDG via 0x. */
export function useSellQuote(asset: Asset | null, tokenQtyRaw: bigint, taker?: string) {
  const enabled = Boolean(asset && tokenQtyRaw > BigInt(0));
  return useQuery({
    queryKey: ["sell-quote", asset?.symbol, tokenQtyRaw.toString()],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SellQuote> => {
      const a = asset!;
      const expectedUsdcRaw = await priceOut("sell", a.symbol, tokenQtyRaw, taker ?? PLACEHOLDER_TAKER);
      const expectedUsd = fromUnits(expectedUsdcRaw, USDG.decimals);
      return { amountInRaw: tokenQtyRaw, expectedUsdcRaw, expectedUsd };
    },
  });
}
