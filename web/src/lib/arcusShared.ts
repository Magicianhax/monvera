// Pure helpers shared by every Arcus trade path (client hooks AND the server
// autopilot executor). No imports — keep this file dependency-free.

/** Replace the 65-byte placeholder signature in Arcus settlement calldata. */
export function spliceSignature(
  data: `0x${string}`,
  sig: `0x${string}`,
  byteOffset: number,
): `0x${string}` {
  const d = data.slice(2);
  const s = sig.slice(2);
  const start = byteOffset * 2;
  return `0x${d.slice(0, start)}${s}${d.slice(start + s.length)}`;
}

/**
 * Split a total (in base units) across weighted legs so the parts sum EXACTLY
 * to the total (largest-remainder method). Zero-weight legs get zero.
 */
export function splitByWeights(total: bigint, weightsPct: number[]): bigint[] {
  const weightSum = weightsPct.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return weightsPct.map(() => BigInt(0));
  const exact = weightsPct.map((w) => (total * BigInt(Math.round(w * 100))) / BigInt(Math.round(weightSum * 100)));
  let remainder = total - exact.reduce((s, v) => s + v, BigInt(0));
  // Hand the leftover base units to the largest legs first (stable, deterministic).
  const order = exact
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v === b.v ? a.i - b.i : b.v > a.v ? 1 : -1));
  const out = [...exact];
  for (const { i } of order) {
    if (remainder <= BigInt(0)) break;
    out[i] += BigInt(1);
    remainder -= BigInt(1);
  }
  return out;
}

/**
 * How a quote settles. "tx" venues hand back a settlement transaction we submit
 * ourselves (instant). "rfq" is the `arcus` venue: we POST the signed intent and
 * the router settles it minutes later. Most assets are RFQ-only.
 */
export type VenueKind = "tx" | "rfq" | "none";

/**
 * The order sizes RFQ makers are known to fill, in whole dollars.
 *
 * These are the makers' rules, not ours, and they are only enforced at fill time
 * — a smaller order quotes cleanly and is rejected on submit. So we advise rather
 * than forbid: the user can always try, and a rejection costs them nothing but a
 * signature. Measured against the live router: a $10 buy was rejected, $11 filled.
 */
export const RFQ_MIN_BUY_USD = 11;
export const RFQ_MIN_SELL_USD = 5;

/** The typed-data payload Arcus asks the taker to sign (Permit2 witness transfer). */
export interface ArcusToSign {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * One executable Arcus quote as our /api/quote returns it.
 *
 * `kind` says how it settles:
 *   "tx"  — the venue handed back a settlement tx we splice a signature into and
 *           submit ourselves inside a batched, gas-sponsored userOp (instant).
 *   "rfq" — the `arcus` venue: we POST the signed intent and the ROUTER submits
 *           settlement, delivering a wrapped token that auto-unwraps in ~1-15 min.
 *           Most assets are RFQ-only. Minimum order is roughly $10.
 */
export interface ArcusQuoteResponse {
  kind?: "tx" | "rfq";
  liquidityAvailable: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  needsAllowance?: boolean;
  permit2?: `0x${string}`;
  sellToken?: `0x${string}`;
  sellAmount?: string;
  expiry?: number;
  toSign?: ArcusToSign;
  tx?: { to: `0x${string}`; data: `0x${string}`; value: string; signatureOffset: number };
}

/** Result of handing a signed RFQ intent to the router. */
export interface RfqSubmitResponse {
  txHash: `0x${string}`;
  status: string;
  settledToken: `0x${string}` | null;
  orderId: string | null;
}

/** A polled RFQ fill. */
export interface RfqStatusResponse {
  status: string;
  filled: boolean;
  failed: boolean;
  amountOut: string | null;
  reason: string | null;
}
