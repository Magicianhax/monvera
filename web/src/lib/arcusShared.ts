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

/** The typed-data payload Arcus asks the taker to sign (Permit2 witness transfer). */
export interface ArcusToSign {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** One executable Arcus quote as our /api/quote (and the router) returns it. */
export interface ArcusQuoteResponse {
  liquidityAvailable: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  needsAllowance?: boolean;
  permit2?: `0x${string}`;
  sellToken?: `0x${string}`;
  sellAmount?: string;
  toSign?: ArcusToSign;
  tx?: { to: `0x${string}`; data: `0x${string}`; value: string; signatureOffset: number };
}
