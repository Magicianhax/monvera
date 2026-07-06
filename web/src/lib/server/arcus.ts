import "server-only";

// Arcus spot RFQ router client for Robinhood Chain.
//
// Robinhood stock tokens trade via Arcus's spot RFQ router (aggregates the
// "arcus" + "rialto"/Pleiades maker venues). It is a PUBLIC, no-auth service on a
// separate host from api.arcus.xyz (that's why it isn't in Arcus's OpenAPI):
//   GET /v1/price?chainId&sellToken&buyToken&sellAmount            -> indicative
//   GET /v1/quote?chainId&sellToken&buyToken&sellAmount&taker&slippageBps -> firm
//
// A firm quote returns everything to execute non-custodially:
//   - toSign: a Permit2 `PermitWitnessTransferFrom` (EIP-712) the taker signs
//   - tx:     {to, data, value, signatureOffset} — the settlement call; splice the
//             taker's signature into `data` at `signatureOffset`, then submit it
//   - needsAllowance: whether the taker must first approve sellToken -> Permit2
// Settlement is one atomic on-chain tx; verified working via server curl (no key).

import type { Address, Hex } from "viem";
import { CHAIN_ID } from "@/lib/chain";

const ROUTER = process.env.ARCUS_ROUTER_URL || "https://router.spot.arcus.xyz";
// Our affiliate/referral code (revenue on routed volume) — public, not a secret.
// Registered at app.arcus.xyz/ref/NANI; env can override.
const REFERRAL = process.env.ARCUS_REFERRAL_CODE || "NANI";
const DEFAULT_SLIPPAGE_BPS = 100; // 1%

// Canonical Permit2 (the approve spender). Confirmed on Robinhood Chain.
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// Only the response fields we consume (the router returns much more under `raw`).
interface VenueQuote {
  venue: string;
  buyAmount: string;
  sellAmount: string;
  minBuyAmount?: string;
  quoteId?: string;
  needsAllowance?: boolean;
  toSign?: unknown;
  tx?: { to: string; data: string; value?: string; signatureOffset?: number; estimatedGas?: number };
  raw?: { issues?: { allowance?: { spender?: string } | null } };
}
interface RouterResponse {
  recommended?: string;
  all?: VenueQuote[];
  errors?: unknown[];
}

/** Pick the recommended venue quote, else the one with the largest buyAmount. */
function pick(r: RouterResponse): VenueQuote | null {
  const all = r.all ?? [];
  if (all.length === 0) return null;
  if (r.recommended) {
    const match = all.find((q) => q.venue === r.recommended && q.buyAmount);
    if (match) return match;
  }
  return all
    .filter((q) => q.buyAmount)
    .reduce<VenueQuote | null>(
      (best, q) => (!best || BigInt(q.buyAmount) > BigInt(best.buyAmount) ? q : best),
      null,
    );
}

async function routerGet(path: string, params: URLSearchParams): Promise<RouterResponse> {
  const res = await fetch(`${ROUTER}${path}?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  const json = (await res.json()) as RouterResponse;
  if (!res.ok) throw new Error(`Arcus router ${res.status}`);
  return json;
}

/** Indicative executable price for a pre-trade "you'll get X" line (no taker needed). */
export async function getPrice(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
): Promise<{ liquidityAvailable: boolean; buyAmount: bigint }> {
  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
  });
  const q = pick(await routerGet("/v1/price", params));
  return q ? { liquidityAvailable: true, buyAmount: BigInt(q.buyAmount) } : { liquidityAvailable: false, buyAmount: BigInt(0) };
}

export interface ArcusQuote {
  liquidityAvailable: boolean;
  buyAmount: bigint;
  minBuyAmount: bigint;
  /** True if the taker must approve sellToken -> Permit2 before settling. */
  needsAllowance: boolean;
  /** Permit2 EIP-712 typed data the taker signs (pass straight to signTypedData_v4). */
  toSign: unknown | null;
  /** The settlement tx; splice the signature into `data` at `signatureOffset`. */
  tx: { to: Address; data: Hex; value: string; signatureOffset: number } | null;
  quoteId: string | null;
}

/** Firm quote for `taker` -> the signable intent + settlement tx. */
export async function getQuote(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  taker: Address,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): Promise<ArcusQuote> {
  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker,
    slippageBps: String(slippageBps),
  });
  if (REFERRAL) params.set("referralCode", REFERRAL);

  const q = pick(await routerGet("/v1/quote", params));
  if (!q || !q.tx || !q.toSign) {
    return { liquidityAvailable: false, buyAmount: BigInt(0), minBuyAmount: BigInt(0), needsAllowance: false, toSign: null, tx: null, quoteId: null };
  }
  return {
    liquidityAvailable: true,
    buyAmount: BigInt(q.buyAmount),
    minBuyAmount: BigInt(q.minBuyAmount ?? q.buyAmount),
    needsAllowance: Boolean(q.needsAllowance),
    toSign: q.toSign,
    tx: {
      to: q.tx.to as Address,
      data: q.tx.data as Hex,
      value: q.tx.value ?? "0",
      signatureOffset: q.tx.signatureOffset ?? 0,
    },
    quoteId: q.quoteId ?? null,
  };
}
