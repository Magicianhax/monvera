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
import { assetBySymbol, USDG } from "@/lib/tokens";

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

/** The best of `venues` by buyAmount, preferring `recommended` when it qualifies. */
function best(venues: VenueQuote[], recommended?: string): VenueQuote | null {
  if (venues.length === 0) return null;
  const rec = recommended && venues.find((q) => q.venue === recommended);
  if (rec) return rec;
  return venues.reduce((top, q) => (BigInt(q.buyAmount) > BigInt(top.buyAmount) ? q : top));
}

/** Pick a venue for an indicative price. Any venue that quotes a size will do. */
function pickPriced(r: RouterResponse): VenueQuote | null {
  return best((r.all ?? []).filter((q) => q.buyAmount), r.recommended);
}

/**
 * Pick a venue we can actually execute. We settle every fill inside one batched,
 * gas-sponsored userOp, so we need the venue to hand back a client-submittable
 * `tx` (we splice the taker signature into it) plus the `toSign` intent.
 *
 * The router's `recommended` venue is currently always `arcus`, its own RFQ flow,
 * where *the router* submits settlement server-side. It returns `toSign` but no
 * `tx`, so it is unusable here — trusting `recommended` blindly made every buy and
 * sell report "No liquidity". Prefer `recommended` only among submittable venues.
 */
function pickExecutable(r: RouterResponse): VenueQuote | null {
  const submittable = (r.all ?? []).filter((q) => q.buyAmount && q.tx?.to && q.tx?.data && q.toSign);
  return best(submittable, r.recommended);
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
  const q = pickPriced(await routerGet("/v1/price", params));
  return q ? { liquidityAvailable: true, buyAmount: BigInt(q.buyAmount) } : { liquidityAvailable: false, buyAmount: BigInt(0) };
}

// ── Liquidity pre-screen ──────────────────────────────────────────────────────
// A token can be "buyable" in our registry yet have no live RFQ liquidity right
// now (a maker pulled out, a listing went cold). If Vera proposes such a token,
// the invest fails at execution ("No liquidity for SOXX"). So before building a
// plan we probe which symbols actually have liquidity and only allocate over
// those. This covers both Vera (interactive) and Autopilot, which share the
// allocator. The indicative /v1/price probe needs no taker and is cheap; results
// are cached briefly so a plan request rarely pays for the whole sweep.
const PROBE_MICRO = BigInt(10_000_000); // $10 of USDG — a "is there any liquidity" signal
const LIQUID_TTL_MS = 90_000;
// Probe with a FIRM quote (not indicative /v1/price): some tokens quote a price
// but have no firm-executable quote (no tx/toSign), which is exactly what fails
// at invest time ("No liquidity for SOXX"). The taker is a throwaway placeholder
// — liquidity availability is taker-independent and nothing here is signed.
const PROBE_TAKER = "0x000000000000000000000000000000000000dEaD" as const;
// Per-symbol cache so repeated picks across plans don't re-probe within the TTL.
const liquidCache = new Map<string, { at: number; liquid: boolean }>();

async function probeLiquid(symbol: string): Promise<boolean> {
  const hit = liquidCache.get(symbol);
  if (hit && Date.now() - hit.at < LIQUID_TTL_MS) return hit.liquid;
  const asset = assetBySymbol(symbol);
  if (!asset) return false;
  let liquid: boolean;
  try {
    const q = await getQuote(USDG.address as Address, asset.address, PROBE_MICRO, PROBE_TAKER);
    liquid = q.liquidityAvailable;
  } catch {
    // Transient probe failure: don't exclude on a blip (execution guards it).
    return true;
  }
  liquidCache.set(symbol, { at: Date.now(), liquid });
  return liquid;
}

/**
 * The subset of `symbols` with live, firm-executable Arcus liquidity right now
 * (per-symbol cache, ~90s). A symbol is EXCLUDED only on a definitive "no firm
 * quote" answer; a probe that throws (network/transient) is treated as liquid so
 * we never over-filter on a blip. Returns null if EVERY symbol came back
 * illiquid (router likely unreachable), so callers can fall back to the picks
 * rather than block a plan on a total outage.
 */
export async function liquidSymbols(symbols: string[]): Promise<Set<string> | null> {
  const flags = await Promise.all(symbols.map(async (s) => [s, await probeLiquid(s)] as const));
  const liquid = new Set(flags.filter(([, ok]) => ok).map(([s]) => s));
  if (symbols.length > 0 && liquid.size === 0) return null;
  return liquid;
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

  const q = pickExecutable(await routerGet("/v1/quote", params));
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
