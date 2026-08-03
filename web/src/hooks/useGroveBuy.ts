"use client";

// Buy a Grove: quote every leg, prove the contract can actually execute it, then
// send one sponsored UserOp.
//
// This deliberately does NOT follow the per-leg "quote, settle, skip the
// failures" ladder that useInvest uses. A grove buy is one atomic call — the
// user gets the whole basket or nothing — so a leg that cannot be priced is a
// reason to stop before spending gas, not a leg to drop. That is why the server
// refuses the whole quote when any component is unquotable.
import { useCallback, useMemo, useRef, useState } from "react";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { chain, RPC_URL } from "@/lib/chain";
import { USDG } from "@/lib/tokens";
import { authHeader } from "@/lib/authedFetch";
import { explainError } from "@/lib/explainError";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useRefreshBalances } from "@/hooks/useBalances";
import { asViemProvider } from "@/lib/provider";
import { getSmartAccountClient, sendSponsoredCalls } from "@/lib/aa";
import { buildPermitCall } from "@/lib/permit";
import { typedDataSigner } from "@/lib/arcusTrade";
import {
  GROVE_MANAGER,
  GROVE_MANAGER_ABI,
  buildGroveBuyCalls,
  type GroveBuyQuoteJson,
} from "@/lib/groveManager";

const client = createPublicClient({ chain, transport: http(RPC_URL) });

export type GroveBuyPhase = "idle" | "quoting" | "checking" | "signing" | "buying" | "done" | "error";

export interface GroveBuySuccess {
  txHash: `0x${string}`;
  groveId: string;
  totalUsd: number;
  legs: { symbol: string; amountUsd: number; expectedOut: string }[];
}

export interface UseGroveBuy {
  phase: GroveBuyPhase;
  busy: boolean;
  error: string | null;
  quote: GroveBuyQuoteJson | null;
  success: GroveBuySuccess | null;
  /** Price a buy without sending anything. Safe to call on input change. */
  getQuote: (groveId: string, amountUsd: number) => Promise<GroveBuyQuoteJson | null>;
  /** Quote (or reuse a fresh quote) and execute. */
  buy: (groveId: string, amountUsd: number) => Promise<void>;
  reset: () => void;
}

/**
 * Ask the contract whether this basket can execute at all, before the user
 * signs anything. Every one of these is a real revert waiting to happen:
 * a venue still inside its 48h timelock, a component with no feed (UNPRICEABLE
 * -> no entry), or a paused contract. Far better to say "opens soon" than to
 * burn a signature on TargetNotAllowed.
 */
async function preflight(quote: GroveBuyQuoteJson): Promise<string | null> {
  const tokens = [...new Set(quote.legs.map((l) => l.tokenOut))];

  const [paused, callOk, approveOk, feeds] = await Promise.all([
    client.readContract({ address: quote.groveManager, abi: GROVE_MANAGER_ABI, functionName: "paused" }),
    Promise.all(
      quote.legs.map((l) =>
        client.readContract({
          address: quote.groveManager,
          abi: GROVE_MANAGER_ABI,
          functionName: "callTargetAllowed",
          args: [l.callTarget],
        }),
      ),
    ),
    Promise.all(
      quote.legs.map((l) =>
        client.readContract({
          address: quote.groveManager,
          abi: GROVE_MANAGER_ABI,
          functionName: "approvalTargetAllowed",
          args: [l.approvalTarget],
        }),
      ),
    ),
    Promise.all(
      tokens.map((t) =>
        client.readContract({
          address: quote.groveManager,
          abi: GROVE_MANAGER_ABI,
          functionName: "feedOf",
          args: [t],
        }),
      ),
    ),
  ]);

  if (paused) return "Groves are paused right now. Nothing was sent.";
  if (callOk.some((ok) => !ok) || approveOk.some((ok) => !ok)) {
    return "This grove is not open for trading yet — its venue is still inside the 48h timelock. Nothing was sent.";
  }
  const ZERO = "0x0000000000000000000000000000000000000000";
  const missing = feeds.map((f, i) => (f[0] === ZERO ? tokens[i] : null)).filter(Boolean);
  if (missing.length) {
    const syms = quote.legs.filter((l) => missing.includes(l.tokenOut)).map((l) => l.symbol);
    return `${[...new Set(syms)].join(", ")} cannot be priced on-chain yet, so the basket cannot be bought. Nothing was sent.`;
  }
  return null;
}

export function useGroveBuy(): UseGroveBuy {
  const wallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<GroveBuyPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<GroveBuyQuoteJson | null>(null);
  const [success, setSuccess] = useState<GroveBuySuccess | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setQuote(null);
    setSuccess(null);
  }, []);

  // Monotonic ticket per quote request. Fetches can resolve out of order (type
  // 100, then 150: the $100 response may land last), and committing a stale
  // one would show a receipt for a different trade than the one requested.
  // A superseded resolution is discarded whole: no setQuote, no phase flip.
  const quoteSeq = useRef(0);

  const getQuote = useCallback(async (groveId: string, amountUsd: number) => {
    const seq = ++quoteSeq.current;
    setError(null);
    setPhase("quoting");
    try {
      const res = await fetch("/api/groves/quote", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ groveId, amountUsd }),
      });
      const json = await res.json().catch(() => null);
      if (seq !== quoteSeq.current) return null;
      if (!res.ok) throw new Error(json?.error || json?.message || "Could not price that basket.");
      setQuote(json as GroveBuyQuoteJson);
      setPhase("idle");
      return json as GroveBuyQuoteJson;
    } catch (err) {
      if (seq !== quoteSeq.current) return null;
      setError(explainError(err));
      setPhase("error");
      return null;
    }
  }, []);

  const buy = useCallback(
    async (groveId: string, amountUsd: number) => {
      setError(null);
      setSuccess(null);
      // Stock pools reprice in discrete oracle steps — when a leg dies on the
      // venue's price floor mid-flight, one automatic fresh-quote attempt
      // usually lands on the new price. One only: a second failure means the
      // market is genuinely moving, and the user should see that.
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!GROVE_MANAGER) throw new Error("Groves are not live yet.");
        if (!wallet?.address) throw new Error("Connect your wallet first.");

        // Always quote immediately before sending — the calldata carries a
        // deadline and a slippage bound, and every leg shares them.
        setPhase("quoting");
        const q = await getQuote(groveId, amountUsd);
        if (!q) return;

        setPhase("checking");
        const blocked = await preflight(q);
        if (blocked) throw new Error(blocked);

        const eoa = wallet.address as Address;
        const provider = (await wallet.getEthereumProvider()) as Parameters<typeof typedDataSigner>[0];
        const viemProvider = asViemProvider(provider);
        const { owner: smartAccount } = await getSmartAccountClient(viemProvider);
        const signTyped = typedDataSigner(provider, eoa);

        // Cash already parked at the smart account (grove-exit proceeds) funds
        // the buy FIRST; only the shortfall crosses from the EOA. Read the raw
        // balance now — display caches are too stale to size a transfer by.
        const smartUsdg = await client.readContract({
          address: USDG.address as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [smartAccount as Address],
        });

        setPhase("signing");
        const calls = await buildGroveBuyCalls(
          q,
          eoa,
          smartAccount as Address,
          (owner, spender, token, value) => buildPermitCall(signTyped, owner, spender, token, value),
          smartUsdg,
        );

        // Deliberately NOT simulating buy() here. The approve is step 3 of this
        // same batch, so a standalone eth_call always reverts at the USDG pull
        // with InsufficientAllowance() — verified against the live contract —
        // and that error belongs to USDG, not GroveManager, so it does not even
        // decode against this ABI. Simulating would mean reporting a failure on
        // every healthy buy. preflight() above covers the cases actually worth
        // stopping for; the rest surface as a real revert with its own reason.
        setPhase("buying");
        const receipt = await sendSponsoredCalls(viemProvider, calls);
        if (!receipt.success) {
          // The hash goes to the console, not the message: hex in the message
          // stops explainError's pass-through and lands on the wrong rule.
          console.error("[grove-buy] reverted on-chain", receipt.receipt.transactionHash);
          throw new Error("The buy reverted on-chain, so nothing was spent. Try again — the next quote is fresh.");
        }

        setSuccess({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          groveId: q.groveId,
          totalUsd: Number(q.totalInUsdg) / 1e6,
          legs: q.legs.map((l) => ({
            symbol: l.symbol,
            amountUsd: Number(l.amountIn) / 1e6,
            expectedOut: l.expectedOut,
          })),
        });
        setPhase("done");
        // The basket (and any spent grove cash) just moved — refetch now.
        refreshBalances();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && /return amount is not enough|52657475726e20616d6f756e74/i.test(msg)) continue;
        // Raw provider/bundler errors arrive as pages of calldata hex — a real
        // user saw one. explainError passes our own copy through untouched and
        // turns everything else into one honest sentence.
        setError(explainError(err));
        setPhase("error");
        return;
      }
      }
    },
    [wallet, getQuote, refreshBalances],
  );

  const busy = phase === "quoting" || phase === "checking" || phase === "signing" || phase === "buying";
  return useMemo(
    () => ({ phase, busy, error, quote, success, getQuote, buy, reset }),
    [phase, busy, error, quote, success, getQuote, buy, reset],
  );
}
