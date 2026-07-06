"use client";

// Client-side Arcus trade plumbing shared by useSwap (manual buy/sell) and
// useInvest (Vera's multi-leg basket): fetch a firm quote through our authed
// /api/quote, sign its Permit2 intent with the embedded EOA, and turn it into
// a settlement Call ready for the gasless relay.
import type { Call } from "@/lib/aa";
import { authHeader } from "@/lib/authedFetch";
import { spliceSignature, type ArcusQuoteResponse } from "@/lib/arcusShared";

// EIP-1193 request shape (Privy's embedded-wallet provider signs with the EOA).
export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Sign EIP-712 typed data with the EOA (plain 65-byte signature Arcus accepts). */
export function typedDataSigner(provider: Eip1193, eoa: `0x${string}`) {
  return (typedDataJson: string) =>
    provider.request({ method: "eth_signTypedData_v4", params: [eoa, typedDataJson] }) as Promise<`0x${string}`>;
}

/** Firm quote via our authed /api/quote. Throws with a friendly message. */
export async function fetchArcusQuote(params: {
  side: "buy" | "sell";
  symbol: string;
  sellAmount: bigint;
  taker: string;
}): Promise<ArcusQuoteResponse> {
  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ mode: "quote", ...params, sellAmount: params.sellAmount.toString() }),
  });
  const json = (await res.json()) as ArcusQuoteResponse & { error?: string };
  if (!res.ok) throw new Error(json.error || "Couldn't get a price. Try again.");
  if (!json.liquidityAvailable || !json.tx || !json.toSign) {
    throw new Error(`No liquidity for ${params.symbol} right now.`);
  }
  return json;
}

/** Sign a quote's Permit2 intent and produce its settlement call. */
export async function settleCallFor(
  quote: ArcusQuoteResponse,
  signTyped: (typedDataJson: string) => Promise<`0x${string}`>,
): Promise<Call> {
  const sig = await signTyped(JSON.stringify(quote.toSign));
  return {
    to: quote.tx!.to,
    data: spliceSignature(quote.tx!.data, sig, quote.tx!.signatureOffset),
    value: BigInt(quote.tx!.value || "0"),
  };
}
