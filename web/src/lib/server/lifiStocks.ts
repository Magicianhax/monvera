import "server-only";

// LiFi as a real execution venue for stocks on Robinhood Chain (same
// LIFI_API_KEY the $MONVERA swap routing already uses). LiFi's
// transactionRequest is sender-dependent, so execution reuses the MONVERA
// batch shape: the EOA signs an exact-amount EIP-2612 permit, the smart
// account pulls the sell token, approves LiFi's spender, and executes the
// route with toAddress = the EOA — output lands directly in the user's wallet,
// no sweep needed. `lifiPrice` stays as the lightweight price-only probe.
import type { Address } from "viem";
import { chain } from "@/lib/chain";

const KEY = process.env.LIFI_API_KEY;

export interface LifiExecQuote {
  buyAmount: bigint;
  minBuyAmount: bigint;
  /** LiFi's spender for the sell token — the smart account approves exactly the trade amount. */
  approvalAddress: `0x${string}`;
  /** Executed BY the smart account (fromAddress); output goes straight to the recipient EOA. */
  tx: { to: `0x${string}`; data: `0x${string}`; value: string };
}

/**
 * Executable LiFi quote: `executor` (the user's smart account) runs the route,
 * `recipient` (the EOA) receives the output. Returns null when the venue is
 * unconfigured or has no route — callers treat null as "can't help".
 */
export async function lifiExecQuote(
  fromToken: Address,
  toToken: Address,
  fromAmountRaw: bigint,
  executor: Address,
  recipient: Address,
): Promise<LifiExecQuote | null> {
  if (!KEY) return null;
  try {
    // LiFi rejects mixed-case addresses that fail EIP-55; lowercase is always valid.
    const params = new URLSearchParams({
      fromChain: String(chain.id),
      toChain: String(chain.id),
      fromToken: fromToken.toLowerCase(),
      toToken: toToken.toLowerCase(),
      fromAmount: fromAmountRaw.toString(),
      fromAddress: executor.toLowerCase(),
      toAddress: recipient.toLowerCase(),
      slippage: "0.005",
    });
    const res = await fetch(`https://li.quest/v1/quote?${params.toString()}`, {
      headers: { "x-lifi-api-key": KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      estimate?: { toAmount?: string; toAmountMin?: string; approvalAddress?: string };
      transactionRequest?: { to?: string; data?: string; value?: string };
    };
    const tx = j.transactionRequest;
    const est = j.estimate;
    if (!est?.toAmount || !est.approvalAddress || !tx?.to || !tx.data) return null;
    return {
      buyAmount: BigInt(est.toAmount),
      minBuyAmount: BigInt(est.toAmountMin ?? est.toAmount),
      approvalAddress: est.approvalAddress as `0x${string}`,
      tx: {
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: String(tx.value ? BigInt(tx.value) : "0"),
      },
    };
  } catch {
    return null;
  }
}

export async function lifiPrice(
  fromToken: Address,
  toToken: Address,
  fromAmountRaw: bigint,
  fromAddress: Address,
): Promise<bigint | null> {
  if (!KEY) return null;
  try {
    const params = new URLSearchParams({
      fromChain: String(chain.id),
      toChain: String(chain.id),
      fromToken: fromToken.toLowerCase(),
      toToken: toToken.toLowerCase(),
      fromAmount: fromAmountRaw.toString(),
      fromAddress: fromAddress.toLowerCase(),
      slippage: "0.005",
    });
    const res = await fetch(`https://li.quest/v1/quote?${params.toString()}`, {
      headers: { "x-lifi-api-key": KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { estimate?: { toAmount?: string } };
    return j.estimate?.toAmount ? BigInt(j.estimate.toAmount) : null;
  } catch {
    return null;
  }
}
