"use client";

// Client-side Arcus trade plumbing shared by useSwap (manual buy/sell) and
// useInvest (Vera's multi-leg basket): fetch a firm quote through our authed
// /api/quote, sign its Permit2 intent with the embedded EOA, and turn it into
// a settlement Call ready for the gasless relay.
import type { Call } from "@/lib/aa";
import { authHeader } from "@/lib/authedFetch";
import {
  spliceSignature,
  type ArcusQuoteResponse,
  type RfqStatusResponse,
  type RfqSubmitResponse,
} from "@/lib/arcusShared";

// EIP-1193 request shape (Privy's embedded-wallet provider signs with the EOA).
export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Sign EIP-712 typed data with the EOA (plain 65-byte signature Arcus accepts). */
export function typedDataSigner(provider: Eip1193, eoa: `0x${string}`) {
  return (typedDataJson: string) =>
    provider.request({ method: "eth_signTypedData_v4", params: [eoa, typedDataJson] }) as Promise<`0x${string}`>;
}

/**
 * Firm quote via our authed /api/quote. Throws with a friendly message.
 *
 * A quote is executable when it carries an intent to sign, whether it settles as
 * our own tx ("tx") or via the router ("rfq"). Requiring a `tx` here is what made
 * every RFQ-only asset report "No liquidity".
 */
export async function fetchArcusQuote(params: {
  side: "buy" | "sell";
  symbol: string;
  sellAmount: bigint;
  taker: string;
  /** Force the router-settled venue (used to retry legs whose "tx" settle reverts). */
  venue?: "rfq";
}): Promise<ArcusQuoteResponse> {
  const res = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ mode: "quote", ...params, sellAmount: params.sellAmount.toString() }),
  });
  const json = (await res.json()) as ArcusQuoteResponse & { error?: string };
  if (!res.ok) throw new Error(json.error || "Couldn't get a price. Try again.");
  if (!json.liquidityAvailable || !json.toSign) {
    throw new Error(`No liquidity for ${params.symbol} right now.`);
  }
  if (json.kind === "tx" && !json.tx) {
    throw new Error(`No liquidity for ${params.symbol} right now.`);
  }
  return json;
}

/** Hand a signed RFQ intent to the router (it submits settlement on-chain). */
export async function submitRfqIntent(
  quote: ArcusQuoteResponse,
  taker: string,
  signTyped: (typedDataJson: string) => Promise<`0x${string}`>,
): Promise<RfqSubmitResponse> {
  const signature = await signTyped(JSON.stringify(quote.toSign));
  const res = await fetch("/api/quote/submit", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ taker, typedData: quote.toSign, signature }),
  });
  const json = (await res.json()) as RfqSubmitResponse & { error?: string };
  if (!res.ok) throw new Error(json.error || "Couldn't place that trade. Try again.");
  return json;
}

/**
 * A settlement failure reason the user can actually read. The router reports
 * raw revert selectors (e.g. 0x151d90fe = ValidationSignatureSegmentMissing(),
 * a failure inside Arcus's own settlement assembly — nothing moved).
 */
function friendlyRfqFailure(reason: string | null): string {
  if (!reason) return "That trade didn't go through. Nothing was charged.";
  if (/^0x[0-9a-fA-F]{8}$/.test(reason)) {
    return "The trading venue couldn't settle this order (their side rejected it). Nothing was charged — try again in a minute.";
  }
  return reason;
}

/**
 * Poll a submitted RFQ fill until it settles.
 *
 * Throws ONLY when the router reports the fill actually failed. A timeout is not
 * a failure: the trade is signed, submitted and on-chain, so we hand back
 * `timedOut` and let the caller show "settling" rather than "your trade failed".
 */
export async function waitForRfqFill(
  txHash: `0x${string}`,
  opts: { timeoutMs?: number; onTick?: (s: RfqStatusResponse) => void } = {},
): Promise<RfqStatusResponse & { timedOut: boolean }> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60_000;
  const deadline = Date.now() + timeoutMs;
  let delay = 2_000;
  let last: RfqStatusResponse = { status: "submitted", filled: false, failed: false, amountOut: null, reason: null };
  for (;;) {
    const res = await fetch(`/api/quote/status?id=${txHash}`, { headers: { ...(await authHeader()) } });
    if (res.ok) {
      last = (await res.json()) as RfqStatusResponse;
      opts.onTick?.(last);
      if (last.filled) return { ...last, timedOut: false };
      if (last.failed) throw new Error(friendlyRfqFailure(last.reason));
    }
    if (Date.now() > deadline) return { ...last, timedOut: true };
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 10_000);
  }
}

/**
 * Sign a quote's Permit2 intent and produce its settlement call.
 *
 * Only "tx" quotes can become a Call. An RFQ quote has no client tx — the router
 * settles it — so it must go through submitRfqIntent instead. Guarded rather than
 * asserted: these two paths share a quote type, and silently dereferencing a
 * missing tx would fail deep inside a signing flow.
 */
export async function settleCallFor(
  quote: ArcusQuoteResponse,
  signTyped: (typedDataJson: string) => Promise<`0x${string}`>,
): Promise<Call> {
  const tx = quote.tx;
  if (!tx) throw new Error("This stock settles differently and can't be part of a basket yet.");
  const sig = await signTyped(JSON.stringify(quote.toSign));
  return {
    to: tx.to,
    data: spliceSignature(tx.data, sig, tx.signatureOffset),
    value: BigInt(tx.value || "0"),
  };
}
