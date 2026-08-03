"use client";

// Exit a Grove: sell the basket back to USDG in one sponsored UserOp.
//
// Like the buy, this is atomic — one call, every leg, all or nothing. The
// position lives at the SMART ACCOUNT (GroveManager keys on msg.sender), so the
// quote is taken for that address and the proceeds land there too.
//
// The 10% fee applies only to profit above the cost basis being withdrawn. At a
// loss it is zero. The contract computes it; the numbers here are an estimate
// from the quote and are labelled as such in the UI.
//
// If part of the basket already left the wallet (sold through the ordinary
// flows), the quote comes back SHORT_BALANCE with the largest fraction still
// coverable, and `closePosition` is the recovery: one sponsored call that
// zeroes the accounting with no swap and no fee.
import { useCallback, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { authHeader } from "@/lib/authedFetch";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useRefreshBalances } from "@/hooks/useBalances";
import { asViemProvider } from "@/lib/provider";
import { getSmartAccountClient, sendSponsoredCalls } from "@/lib/aa";
import {
  GROVE_MANAGER,
  buildGroveExitCalls,
  buildClosePositionCall,
  type GroveExitQuoteJson,
} from "@/lib/groveManager";

export type GroveExitPhase = "idle" | "quoting" | "signing" | "exiting" | "clearing" | "done" | "error";

export interface GroveExitSuccess {
  txHash: `0x${string}`;
  groveId: string;
  /** What the quote expected to net, USD. The receipt is the truth. */
  expectedUsd: number;
  feeUsd: number;
  fractionBps: number;
  /** True when this was a closePosition (accounting zeroed, nothing sold). */
  cleared?: boolean;
}

/** The wallet no longer covers the tracked position (sold outside the Grove). */
export interface GroveExitShortfall {
  /** Largest fractionBps an exit can still cover; 0 = closePosition only. */
  maxFractionBps: number;
  message: string;
}

export interface UseGroveExit {
  phase: GroveExitPhase;
  busy: boolean;
  error: string | null;
  quote: GroveExitQuoteJson | null;
  success: GroveExitSuccess | null;
  shortfall: GroveExitShortfall | null;
  getQuote: (groveId: string, fractionBps: number) => Promise<GroveExitQuoteJson | null>;
  exit: (groveId: string, fractionBps: number) => Promise<void>;
  /** The zero-fee hatch: zero the accounting without selling. */
  closePosition: (groveId: string, onChainId: number) => Promise<void>;
  reset: () => void;
}

export function useGroveExit(): UseGroveExit {
  const wallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<GroveExitPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<GroveExitQuoteJson | null>(null);
  const [success, setSuccess] = useState<GroveExitSuccess | null>(null);
  const [shortfall, setShortfall] = useState<GroveExitShortfall | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setQuote(null);
    setSuccess(null);
    setShortfall(null);
  }, []);

  /** The address that actually holds the position. */
  const smartAccountAddress = useCallback(async (): Promise<Address> => {
    if (!wallet) throw new Error("Connect your wallet first.");
    const provider = await wallet.getEthereumProvider();
    const { owner } = await getSmartAccountClient(asViemProvider(provider));
    return owner as Address;
  }, [wallet]);

  // Monotonic ticket per quote request: fetches can resolve out of order when
  // the user flips fractions quickly, and a stale resolution must be discarded
  // whole rather than clobbering the quote for the CURRENT selection.
  const quoteSeq = useRef(0);

  const getQuote = useCallback(
    async (groveId: string, fractionBps: number) => {
      const seq = ++quoteSeq.current;
      setError(null);
      setShortfall(null);
      setPhase("quoting");
      try {
        const user = await smartAccountAddress();
        const res = await fetch("/api/groves/exit", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ groveId, user, fractionBps }),
        });
        const json = await res.json().catch(() => null);
        if (seq !== quoteSeq.current) return null;
        if (!res.ok) {
          if (json?.code === "SHORT_BALANCE") {
            setShortfall({
              maxFractionBps: typeof json.maxFractionBps === "number" ? json.maxFractionBps : 0,
              message: typeof json.error === "string" ? json.error : "Part of this basket has left your wallet.",
            });
          }
          throw new Error(json?.error || json?.message || "Could not price that exit.");
        }
        setQuote(json as GroveExitQuoteJson);
        setPhase("idle");
        return json as GroveExitQuoteJson;
      } catch (err) {
        if (seq !== quoteSeq.current) return null;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
        return null;
      }
    },
    [smartAccountAddress],
  );

  const exit = useCallback(
    async (groveId: string, fractionBps: number) => {
      setError(null);
      setSuccess(null);
      try {
        if (!GROVE_MANAGER) throw new Error("Groves are not live yet.");
        if (!wallet?.address) throw new Error("Connect your wallet first.");

        // Re-quote immediately before sending: the calldata carries a deadline
        // and a slippage bound, and all legs share them.
        setPhase("quoting");
        const q = await getQuote(groveId, fractionBps);
        if (!q) return;

        const provider = await wallet.getEthereumProvider();
        const viemProvider = asViemProvider(provider);

        setPhase("signing");
        const calls = buildGroveExitCalls(q);

        setPhase("exiting");
        const receipt = await sendSponsoredCalls(viemProvider, calls);
        if (!receipt.success) {
          throw new Error(`The exit reverted on-chain (tx ${receipt.receipt.transactionHash}). Nothing was sold.`);
        }

        setSuccess({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          groveId: q.groveId,
          expectedUsd: (Number(q.expectedProceedsUsdg) - Number(q.estimatedFeeUsdg)) / 1e6,
          feeUsd: Number(q.estimatedFeeUsdg) / 1e6,
          fractionBps: q.fractionBps,
        });
        setPhase("done");
        // Proceeds just landed at the smart account — the portfolio, the
        // grove-cash bar, and the activity feed must all say so NOW.
        refreshBalances();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [wallet, getQuote, refreshBalances],
  );

  const closePosition = useCallback(
    async (groveId: string, onChainId: number) => {
      setError(null);
      setSuccess(null);
      try {
        if (!GROVE_MANAGER) throw new Error("Groves are not live yet.");
        if (!wallet?.address) throw new Error("Connect your wallet first.");

        const provider = await wallet.getEthereumProvider();
        const viemProvider = asViemProvider(provider);

        setPhase("clearing");
        const receipt = await sendSponsoredCalls(viemProvider, [buildClosePositionCall(onChainId)]);
        if (!receipt.success) {
          throw new Error(
            `Clearing reverted on-chain (tx ${receipt.receipt.transactionHash}). Nothing changed.`,
          );
        }

        setSuccess({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          groveId,
          expectedUsd: 0,
          feeUsd: 0,
          fractionBps: 10_000,
          cleared: true,
        });
        setPhase("done");
        refreshBalances();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [wallet, refreshBalances],
  );

  const busy = phase === "quoting" || phase === "signing" || phase === "exiting" || phase === "clearing";
  return useMemo(
    () => ({ phase, busy, error, quote, success, shortfall, getQuote, exit, closePosition, reset }),
    [phase, busy, error, quote, success, shortfall, getQuote, exit, closePosition, reset],
  );
}
