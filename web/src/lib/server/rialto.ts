import "server-only";

// Rialto — fallback execution venue for tokenized stocks when Arcus can't
// quote or settle (docs.rialto.xyz). We request settlement=permit2 so the
// returned tx is sender-agnostic: the EOA signs the Permit2 intent, the
// signature is spliced at tx.signature_offset, and our sponsored smart-account
// relay submits it — byte-for-byte the same client flow as an Arcus "tx"
// quote, so the fallback needs no client changes at all.
import { formatUnits, type Address } from "viem";
import { chain } from "@/lib/chain";

const BASE = process.env.RIALTO_API_URL || "https://rialto-trade-api.rialto.xyz";
const KEY = process.env.RIALTO_API_KEY;

export function rialtoEnabled(): boolean {
  return Boolean(KEY);
}

export interface RialtoQuote {
  buyAmount: bigint;
  minBuyAmount: bigint;
  needsAllowance: boolean;
  /** The spender to approve when needsAllowance (Permit2, per the quote). */
  allowanceSpender: Address | null;
  /** EIP-712 payload the EOA signs (same splice flow as Arcus). */
  toSign: unknown;
  tx: { to: `0x${string}`; data: `0x${string}`; value: string; signatureOffset: number };
}

interface RialtoRaw {
  quote_id?: string;
  buy_amount?: string | number;
  min_buy_amount?: string | number;
  permit2?: unknown;
  issues?: {
    balance?: unknown;
    allowance?: { spender?: string } | null;
    simulationIncomplete?: boolean;
  };
  tx?: { to?: string; data?: string; value?: string | number; signature_offset?: number; signatureOffset?: number };
}

/**
 * Firm Rialto quote, normalized to the Arcus "tx" contract. Returns null when
 * the venue is unconfigured, has no route, or the quote isn't relay-executable
 * (no permit2 payload / no signature offset) — the caller treats null as
 * "this venue can't help" and moves on.
 */
export async function rialtoQuote(
  sellToken: Address,
  buyToken: Address,
  sellAmountRaw: bigint,
  sellDecimals: number,
  taker: Address,
): Promise<RialtoQuote | null> {
  if (!KEY) return null;
  try {
    const params = new URLSearchParams({
      sell_token: sellToken,
      buy_token: buyToken,
      sell_amount: formatUnits(sellAmountRaw, sellDecimals),
      taker,
      slippage_bps: "50",
      chain_id: String(chain.id),
      settlement: "permit2",
    });
    // Integrator fee (revenue): paid to our registered fee_recipient in the same
    // tx. Requires an integrator-scoped key; harmless to omit otherwise.
    const feeBps = Number(process.env.RIALTO_FEE_BPS ?? 0);
    if (feeBps > 0) params.set("swap_fee_bps", String(Math.min(feeBps, 100)));
    const res = await fetch(`${BASE}/quote?${params.toString()}`, {
      headers: { authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as RialtoRaw;

    const to = j.tx?.to;
    const data = j.tx?.data;
    const offset = j.tx?.signature_offset ?? j.tx?.signatureOffset;
    if (!to || !data || !j.buy_amount || !j.permit2 || typeof offset !== "number") return null;
    // A flagged balance issue means the pull would fail on-chain — don't offer it.
    if (j.issues?.balance) return null;

    return {
      buyAmount: BigInt(j.buy_amount),
      minBuyAmount: BigInt(j.min_buy_amount ?? j.buy_amount),
      needsAllowance: Boolean(j.issues?.allowance),
      allowanceSpender: (j.issues?.allowance?.spender as Address | undefined) ?? null,
      toSign: j.permit2,
      tx: { to: to as `0x${string}`, data: data as `0x${string}`, value: String(j.tx?.value ?? "0"), signatureOffset: offset },
    };
  } catch {
    return null; // network/timeout — fallback venues never throw
  }
}

/** Indicative Rialto price (buyAmount only) for the price mode. */
export async function rialtoPrice(
  sellToken: Address,
  buyToken: Address,
  sellAmountRaw: bigint,
  sellDecimals: number,
  taker: Address,
): Promise<bigint | null> {
  const q = await rialtoQuote(sellToken, buyToken, sellAmountRaw, sellDecimals, taker);
  return q?.buyAmount ?? null;
}
