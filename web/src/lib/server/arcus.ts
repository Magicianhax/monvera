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

import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { CHAIN_ID, chain, RPC_URL } from "@/lib/chain";
import { assetBySymbol, USDG } from "@/lib/tokens";
import type { VenueKind } from "@/lib/arcusShared";

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

// ── Router call pacing ────────────────────────────────────────────────────────
// The router rate-limits per IP, and every one of our users shares the server's
// IP. Prices, portfolio, quotes and the liquidity probe all call it, so an
// unpaced burst trips a 429 that has nothing to do with the user's own trade —
// which surfaced as `POST /api/quote 500` and an app that looked crashed.
//
// Every router call funnels through here: at most a few in flight, spaced out.
// Queueing a request for a few hundred milliseconds is invisible; being throttled
// is not.
const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 90;

let active = 0;
let lastStartAt = 0;
const queue: (() => void)[] = [];

function pump(): void {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  const gap = Math.max(0, lastStartAt + MIN_GAP_MS - Date.now());
  setTimeout(() => {
    const next = queue.shift();
    if (!next) return;
    active += 1;
    lastStartAt = Date.now();
    next();
  }, gap);
}

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    });
    pump();
  });
}

/**
 * GET the router: paced, and retrying a rate-limit with backoff.
 *
 * `retryOn429` is for calls a person is waiting on (a firm quote before a trade).
 * Background pricing passes false: waiting out a throttle there would spend the
 * whole request budget on one token, and it will be retried on the next refresh.
 */
async function routerGet(
  path: string,
  params: URLSearchParams,
  opts: { retryOn429?: boolean } = {},
): Promise<RouterResponse> {
  const url = `${ROUTER}${path}?${params.toString()}`;
  const backoffMs = opts.retryOn429 ? [0, 350, 900, 2000] : [0];
  let lastStatus = 0;
  for (const wait of backoffMs) {
    if (wait) await new Promise((r) => setTimeout(r, wait + Math.random() * 200));
    const res = await schedule(() => fetch(url, { headers: { accept: "application/json" } }));
    if (res.ok) return (await res.json()) as RouterResponse;
    lastStatus = res.status;
    // Only a throttle is worth retrying; a 4xx on the token itself never changes.
    if (res.status !== 429) break;
  }
  throw new Error(`Arcus router ${lastStatus}`);
}

/** Indicative executable price for a pre-trade "you'll get X" line (no taker needed). */
export async function getPrice(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  opts: { retryOn429?: boolean } = { retryOn429: true },
): Promise<{ liquidityAvailable: boolean; buyAmount: bigint }> {
  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
  });
  const q = pickPriced(await routerGet("/v1/price", params, opts));
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

// ── RFQ venue (the `arcus` venue) ─────────────────────────────────────────────
// Only 24 of our 95 assets have a venue that hands back a client-submittable tx.
// The rest quote solely on the `arcus` RFQ venue, where the taker signs the
// Permit2 intent and the ROUTER submits settlement. Flow (undocumented; captured
// from Arcus's own UI):
//   1. GET  /v1/quote                  -> venue "arcus" with `toSign`, no `tx`
//   2. POST /v1/submit {venue, chainId, taker, typedData, signature}
//                                      -> { txHash, status:"submitted", ... }
//   3. GET  /v1/status?venue=arcus&id=<txHash>  (the id IS the txHash)
// The fill arrives as a WRAPPED token (wLITE, wUSDG) that auto-unwraps into the
// real one within ~1-15 min, so we never hold or unwrap it ourselves — we just
// need a "settling" state. `minBuyAmount` is enforced on-chain, so the router
// submitting on our behalf stays non-custodial.

/** Pick the RFQ venue: signable intent, no client tx. */
function pickRfq(r: RouterResponse): VenueQuote | null {
  const rfq = (r.all ?? []).filter((q) => q.buyAmount && q.toSign && !q.tx?.data);
  return best(rfq, r.recommended);
}

export interface ArcusRfqQuote {
  liquidityAvailable: boolean;
  buyAmount: bigint;
  minBuyAmount: bigint;
  expiry: number;
  toSign: unknown | null;
}

/** Firm RFQ quote: the intent to sign, settled by the router after we submit it. */
export async function getRfqQuote(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  taker: Address,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): Promise<ArcusRfqQuote> {
  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker,
    slippageBps: String(slippageBps),
    allowWrapped: "true",
  });
  if (REFERRAL) params.set("referralCode", REFERRAL);

  const q = pickRfq(await routerGet("/v1/quote", params, { retryOn429: true }));
  if (!q || !q.toSign) {
    return { liquidityAvailable: false, buyAmount: BigInt(0), minBuyAmount: BigInt(0), expiry: 0, toSign: null };
  }
  const minOut = (q as { arcus?: { minAmountOut?: string } }).arcus?.minAmountOut;
  return {
    liquidityAvailable: true,
    buyAmount: BigInt(q.buyAmount),
    minBuyAmount: BigInt(minOut ?? q.minBuyAmount ?? q.buyAmount),
    expiry: (q as { expiry?: number }).expiry ?? 0,
    toSign: q.toSign,
  };
}

export interface RfqSubmitResult {
  txHash: Hex;
  status: string;
  /** The wrapped token actually delivered; it auto-unwraps into the real asset. */
  settledToken: Address | null;
  orderId: string | null;
}

/** Hand the signed intent to the router, which submits settlement on-chain. */
export async function submitRfq(
  taker: Address,
  typedData: unknown,
  signature: Hex,
): Promise<RfqSubmitResult> {
  const res = await fetch(`${ROUTER}/v1/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ venue: "arcus", chainId: CHAIN_ID, taker, typedData, signature }),
  });
  const json = (await res.json()) as {
    txHash?: string; status?: string; settledToken?: string; orderId?: string; code?: string; message?: string;
  };
  if (!res.ok || !json.txHash) {
    // The maker rejects sub-minimum orders here (a $10 buy quotes but won't fill).
    throw new Error(json.message || json.code || `Arcus submit failed (${res.status})`);
  }
  return {
    txHash: json.txHash as Hex,
    status: json.status ?? "submitted",
    settledToken: (json.settledToken as Address) ?? null,
    orderId: json.orderId ?? null,
  };
}

export interface RfqStatus {
  status: string;
  filled: boolean;
  failed: boolean;
  amountOut: bigint | null;
  reason: string | null;
}

// ── Price fallback ────────────────────────────────────────────────────────────
// Only ~a third of the universe has a Chainlink feed on this young chain. The
// rest showed a bare "—" everywhere, including on positions the user now holds.
// Arcus quotes all of them, so derive USD/token from an indicative quote. Cached
// hard: this is display pricing, and the trade screen always re-quotes live.
const ARCUS_PRICE_TTL_MS = 300_000; // 5 min
// A token the router can't price (CRWD/SATS 422, or a venue outage) was being
// retried on every 30s refresh, forever. Remember the "no" briefly too — long
// enough to stop the churn, short enough to notice when it starts working.
const ARCUS_PRICE_MISS_TTL_MS = 90_000;
const ARCUS_PRICE_NOTIONAL = BigInt(10_000_000); // $10 of USDG
const arcusPriceCache = new Map<string, { at: number; usd: number | undefined }>();
// /api/prices and /api/portfolio sweep the same tokens at the same moment, and a
// cold cache would fire every quote twice. Share the in-flight request instead.
const arcusPriceInflight = new Map<string, Promise<number | undefined>>();

export async function arcusPriceUsd(token: Address, decimals: number): Promise<number | undefined> {
  const key = token.toLowerCase();
  const hit = arcusPriceCache.get(key);
  if (hit) {
    // A price is good for 5 min; a miss is remembered for 90s so we stop hammering
    // the router with tokens it just told us it cannot price.
    const ttl = hit.usd === undefined ? ARCUS_PRICE_MISS_TTL_MS : ARCUS_PRICE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.usd;
  }

  const pending = arcusPriceInflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      // Background pricing: no one is blocked on this token, so don't sit out a
      // throttle. It will be picked up on the next refresh.
      const p = await getPrice(USDG.address as Address, token, ARCUS_PRICE_NOTIONAL, { retryOn429: false });
      const qty = Number(p.buyAmount) / 10 ** decimals;
      const usd = p.liquidityAvailable && qty > 0 ? 10 / qty : undefined;
      arcusPriceCache.set(key, { at: Date.now(), usd });
      return usd;
    } catch {
      // A throttle is not a verdict on the token — don't cache it as "unpriceable".
      return undefined;
    } finally {
      arcusPriceInflight.delete(key);
    }
  })();
  arcusPriceInflight.set(key, task);
  return task;
}

// ── Venue kind (pre-trade) ────────────────────────────────────────────────────
// The trade screen must know, before the user commits, whether a stock settles
// instantly or through the RFQ venue (minutes, and a maker minimum).
//
// This CANNOT be read off /v1/price: that response lists venues that merely quote
// a price. LITE, for instance, shows `lifi` at $1, yet only `arcus` returns a
// signable, settleable quote — so a price-derived guess says "instant" and the
// warning never appears. Only a firm quote distinguishes them.
//
// Which venues can settle a token is a property of the token, not the amount, so
// one firm quote per pair every few minutes is enough. Cached and single-flighted:
// a keystroke burst collapses into one request, and a throttle isn't waited out.
const KIND_TTL_MS = 300_000; // 5 min
const kindCache = new Map<string, { at: number; kind: VenueKind }>();
const kindInflight = new Map<string, Promise<VenueKind>>();

export async function venueKind(sellToken: Address, buyToken: Address): Promise<VenueKind> {
  const key = `${sellToken}:${buyToken}`.toLowerCase();
  const hit = kindCache.get(key);
  if (hit && Date.now() - hit.at < KIND_TTL_MS) return hit.kind;
  const pending = kindInflight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<VenueKind> => {
    // A representative size: too small and a venue may decline to quote at all.
    const sellingUsdg = sellToken.toLowerCase() === (USDG.address as string).toLowerCase();
    const probeAmount = sellingUsdg ? BigInt(15_000_000) : BigInt("10000000000000000");
    const params = new URLSearchParams({
      chainId: String(CHAIN_ID),
      sellToken,
      buyToken,
      sellAmount: probeAmount.toString(),
      taker: PROBE_TAKER,
      slippageBps: String(DEFAULT_SLIPPAGE_BPS),
      allowWrapped: "true",
    });
    try {
      const r = await routerGet("/v1/quote", params, { retryOn429: false });
      const kind: VenueKind = pickExecutable(r) ? "tx" : pickRfq(r) ? "rfq" : "none";
      kindCache.set(key, { at: Date.now(), kind });
      return kind;
    } catch {
      // Don't cache a blip, and don't invent an RFQ warning for an instant stock:
      // fall back to whatever we last knew, else stay silent.
      return hit?.kind ?? "tx";
    } finally {
      kindInflight.delete(key);
    }
  })();
  kindInflight.set(key, task);
  return task;
}

const rpc = createPublicClient({ chain, transport: http(RPC_URL) });
const ALLOWANCE_ABI = parseAbi(["function allowance(address,address) view returns (uint256)"]);

/**
 * Whether `taker` still owes a sellToken -> Permit2 approval. The RFQ quote (unlike
 * the tx venues) never reports this, so we read it. Fail-closed: an RPC blip asks
 * for the gasless permit again, which is harmless, rather than skipping it and
 * having settlement revert.
 */
export async function needsPermit2Allowance(sellToken: Address, taker: Address, sellAmount: bigint): Promise<boolean> {
  try {
    const allowed = (await rpc.readContract({
      address: sellToken,
      abi: ALLOWANCE_ABI,
      functionName: "allowance",
      args: [taker, PERMIT2],
    })) as bigint;
    return allowed < sellAmount;
  } catch {
    return true;
  }
}

/** Poll a submitted RFQ fill. `id` is the txHash returned by submitRfq. */
export async function getRfqStatus(txHash: Hex): Promise<RfqStatus> {
  const params = new URLSearchParams({ venue: "arcus", id: txHash });
  const res = await fetch(`${ROUTER}/v1/status?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  const json = (await res.json()) as {
    status?: string; reason?: string | null;
    swap?: { amountOut?: string; success?: boolean; reason?: string } | null;
  };
  const status = json.status ?? "unknown";
  const swap = json.swap ?? null;
  return {
    status,
    filled: status === "confirmed" && swap?.success !== false,
    failed: status === "failed" || status === "reverted" || swap?.success === false,
    amountOut: swap?.amountOut ? BigInt(swap.amountOut) : null,
    reason: json.reason ?? swap?.reason ?? null,
  };
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

  const q = pickExecutable(await routerGet("/v1/quote", params, { retryOn429: true }));
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
