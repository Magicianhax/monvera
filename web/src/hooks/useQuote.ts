"use client";

// Pre-trade "you'll get X" quote for the manual buy/sell panel, via 0x RFQ.
// Buy quotes USDG (6dp) -> stock (18dp); sell quotes stock -> USDG. The 0x API key
// lives server-side, so this calls our /api/quote route (mode: "price").
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authHeader } from "@/lib/authedFetch";
import { USDG, type Asset } from "@/lib/tokens";
import { fromUnits } from "@/lib/format";
import type { VenueKind } from "@/lib/arcusShared";

// Every keystroke used to be its own quote: typing "11.50" fired five priced
// requests, each then refetching on a 15s timer. That tripped our own per-user
// rate limit and piled load onto the Arcus router (which throttles per IP, one
// IP for all our users). Wait for the typing to settle first.
const QUOTE_DEBOUNCE_MS = 350;

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

// Indicative price checks don't spend a balance, so a placeholder taker is fine
// when the caller hasn't passed the user's smart-account address yet.
const PLACEHOLDER_TAKER = "0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7";

async function priceOut(
  side: "buy" | "sell",
  symbol: string,
  sellAmount: bigint,
  taker: string,
): Promise<{ out: bigint; kind: VenueKind }> {
  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ mode: "price", side, symbol, sellAmount: sellAmount.toString(), taker }),
  });
  // A throttled router (503) is transient and says nothing about this asset.
  // Throw so react-query keeps the previous quote on screen and retries, rather
  // than rendering a confident "no liquidity" over a temporary blip.
  if (res.status === 503) throw new Error("busy");
  const json = (await res.json()) as { liquidityAvailable?: boolean; buyAmount?: string; kind?: VenueKind };
  const kind = json.kind ?? "tx";
  if (!res.ok || !json.liquidityAvailable || !json.buyAmount) return { out: BigInt(0), kind };
  return { out: BigInt(json.buyAmount), kind };
}

export interface Quote {
  amountInRaw: bigint; // USDG, 6dp
  expectedOutRaw: bigint; // tokenOut, asset.decimals
  expectedOutQty: number;
  pricePerToken: number; // USD per whole token
  /** "rfq" stocks settle in minutes and need at least RFQ_MIN_USD per trade. */
  kind: VenueKind;
}

/** Quote `amountUsd` of USDG into `asset` via 0x. Returns null while disabled/loading. */
export function useQuote(asset: Asset | null, amountUsd: number, taker?: string) {
  const amount = useDebounced(amountUsd, QUOTE_DEBOUNCE_MS);
  const enabled = Boolean(asset && amount > 0);
  return useQuery({
    queryKey: ["quote", asset?.symbol, Math.round(amount * 100)],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Quote> => {
      const a = asset!;
      const amountInRaw = BigInt(Math.round(amount * 1_000_000));
      const { out: expectedOutRaw, kind } = await priceOut("buy", a.symbol, amountInRaw, taker ?? PLACEHOLDER_TAKER);
      const expectedOutQty = fromUnits(expectedOutRaw, a.decimals);
      const pricePerToken = expectedOutQty > 0 ? amount / expectedOutQty : 0;
      return { amountInRaw, expectedOutRaw, expectedOutQty, pricePerToken, kind };
    },
  });
}

export interface SellQuote {
  amountInRaw: bigint; // token, asset.decimals
  expectedUsdcRaw: bigint; // USDG, 6dp
  expectedUsd: number;
  /** "rfq" stocks settle in minutes; the minimum applies to the USDG proceeds. */
  kind: VenueKind;
}

/** Quote selling `tokenQtyRaw` raw units of `asset` into USDG via 0x. */
export function useSellQuote(asset: Asset | null, tokenQtyRaw: bigint, taker?: string) {
  // bigint isn't a stable dep for the debounce; the decimal string is.
  const settledQty = useDebounced(tokenQtyRaw.toString(), QUOTE_DEBOUNCE_MS);
  const qtyRaw = BigInt(settledQty);
  const enabled = Boolean(asset && qtyRaw > BigInt(0));
  return useQuery({
    queryKey: ["sell-quote", asset?.symbol, settledQty],
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SellQuote> => {
      const a = asset!;
      const { out: expectedUsdcRaw, kind } = await priceOut("sell", a.symbol, qtyRaw, taker ?? PLACEHOLDER_TAKER);
      const expectedUsd = fromUnits(expectedUsdcRaw, USDG.decimals);
      return { amountInRaw: qtyRaw, expectedUsdcRaw, expectedUsd, kind };
    },
  });
}
