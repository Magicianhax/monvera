"use client";

// useSwap — manual buy/sell of a Robinhood stock token via the Arcus spot RFQ router.
//
// Arcus only quotes a PLAIN EOA taker, so the Privy embedded wallet (the EOA) is
// the taker, signer, and fund-holder. Gas stays sponsored by relaying the
// EOA-signed calls through a Pimlico smart account. Per trade:
//   1. GET a firm quote from /api/quote for taker = the EOA
//   2. the EOA signs the Permit2 intent (`toSign`) off-chain
//   3. splice that signature into `tx.data` at `signatureOffset`
//   4. if needed, the EOA signs a gasless EIP-2612 permit for the SELL token
//      (USDG on a buy, the stock token on a sell) -> Permit2 allowance
//   5. relay [ permit?, settle ] as one sponsored UserOp (Pimlico pays gas)
// Arcus takes its fee inside the quote; our revenue is the affiliate referralCode
// injected server-side, so there's no separate fee transfer here.
import { useCallback, useState } from "react";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";

import { buildPermitCall } from "@/lib/permit";
import { asViemProvider } from "@/lib/provider";
import {
  fetchArcusQuote,
  settleCallFor,
  submitRfqIntent,
  typedDataSigner,
  waitForRfqFill,
  type Eip1193,
} from "@/lib/arcusTrade";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { type Asset } from "@/lib/tokens";

// "settling": the trade is signed, submitted and on-chain; we're waiting for the
// router's wrapped fill to unwrap into the real token. Never an error state.
type Phase = "idle" | "swapping" | "settling" | "done" | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode buys/sells (never broadcast on-chain).
const DEMO_SWAP_TX = ("0x" + "5a7c2b41".repeat(32).slice(0, 64)) as `0x${string}`;

/** A swap in flight. RFQ fills settle on the router's schedule, not ours. */
interface SwapSubmission {
  txHash: `0x${string}`;
  /** True when the router settles it: the tokens land after a short delay. */
  settling: boolean;
}

/**
 * Fetch a fresh quote, have the EOA sign the intent (+ a permit if needed), and
 * get it settled. Two settlement paths, decided by the venue that quoted:
 *   "tx"  — splice the signature into the venue's tx and relay [permit?, settle]
 *           as one sponsored UserOp. Confirmed the moment the receipt lands.
 *   "rfq" — POST the signed intent; the ROUTER submits settlement. Any permit
 *           must be relayed first, on its own, since there's no call to batch it
 *           with. The fill arrives wrapped and auto-unwraps within ~1-15 min.
 */
export async function executeSwap(
  wallet: NonNullable<ReturnType<typeof useActiveWallet>>,
  params: { side: "buy" | "sell"; symbol: string; sellAmount: bigint },
  // Optional signer override — the silent embedded-wallet signer by default, or a
  // UI-prompting signer for "approve each step" (manual) flows like batch sell.
  signTypedOverride?: (json: string) => Promise<`0x${string}`>,
): Promise<SwapSubmission> {
  const eoa = wallet.address as `0x${string}`;
  const provider = (await wallet.getEthereumProvider()) as Eip1193;
  const signTyped = signTypedOverride ?? typedDataSigner(provider, eoa);

  const settle = async (quote: Awaited<ReturnType<typeof fetchArcusQuote>>): Promise<SwapSubmission> => {
    if (quote.kind === "rfq") {
      // No size check here: the maker's minimum is theirs to enforce, and the trade
      // screen already warned. A rejected order costs the user a signature, not money.
      if (quote.needsAllowance && quote.permit2 && quote.sellToken) {
        const permit = await buildPermitCall(signTyped, eoa, quote.permit2, quote.sellToken);
        await sendSponsoredCalls(asViemProvider(provider), [permit]);
      }
      const submitted = await submitRfqIntent(quote, eoa, signTyped);
      return { txHash: submitted.txHash, settling: true };
    }

    const calls: Call[] = [];
    if (quote.needsAllowance && quote.permit2 && quote.sellToken) {
      // Gasless sellToken -> Permit2 allowance (EOA signs, relayer submits).
      // The pulled token is USDG on a buy and the STOCK token on a sell, so
      // permit whichever the quote is selling — not USDG unconditionally.
      calls.push(await buildPermitCall(signTyped, eoa, quote.permit2, quote.sellToken));
    }
    calls.push(await settleCallFor(quote, signTyped));

    // Relay through the Pimlico smart account — sponsored, so the EOA never pays gas.
    const receipt = await sendSponsoredCalls(asViemProvider(provider), calls);
    return { txHash: receipt.receipt.transactionHash as `0x${string}`, settling: false };
  };

  const quote = await fetchArcusQuote({ ...params, taker: eoa });
  try {
    return await settle(quote);
  } catch (err) {
    // Symbol-dependent: some "tx" settlements revert the router's InvalidAction()
    // guard when relayed from the smart account. Retry those router-settled
    // (venue: "rfq") before surfacing a failure.
    if (quote.kind !== "tx") throw err;
    console.warn(`[swap] ${params.symbol} tx settle failed, retrying via RFQ:`, err instanceof Error ? err.message : err);
    const rfq = await fetchArcusQuote({ ...params, taker: eoa, venue: "rfq" });
    return await settle(rfq);
  }
}

/**
 * Wait for a router-settled fill, refreshing balances when it lands.
 *
 * Returns true only when the router CONFIRMED the fill. A trade that outlives
 * our patience is neither a success nor a failure: it is signed, submitted and
 * on-chain, and we simply don't know yet. We report that honestly rather than
 * printing "Bought AAPL" over a trade that might still revert.
 */
async function settleRfq(
  txHash: `0x${string}`,
  setPhase: (p: Phase) => void,
  refreshBalances: () => void,
): Promise<boolean> {
  setPhase("settling");
  const s = await waitForRfqFill(txHash);
  refreshBalances();
  return !s.timedOut && s.filled;
}

export interface SwapResult {
  txHash: `0x${string}`;
  asset: Asset;
  amountUsd: number;
  /** "buy" (USDG -> asset) or "sell" (asset -> USDG). */
  side: "buy" | "sell";
  /**
   * The trade is on-chain but hasn't confirmed yet (RFQ fills can take minutes).
   * The receipt must say "settling", never "bought"/"sold".
   */
  pending?: boolean;
}

export function useSwap() {
  const activeWallet = useActiveWallet();
  // In demo mode (landing phones + /demo) the app must never broadcast a real swap.
  const demo = useDemo();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  /** Buy `asset` with `amountUsd` of USDG (6dp). */
  const buy = useCallback(
    async (params: { asset: Asset; amountUsd: number }) => {
      const { asset, amountUsd } = params;
      setError(null);
      setResult(null);
      if (demo) {
        setPhase("swapping");
        await sleep(1400);
        setResult({ txHash: DEMO_SWAP_TX, asset, amountUsd, side: "buy" });
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const sellAmount = BigInt(Math.round(amountUsd * 1_000_000));
        if (sellAmount <= BigInt(0)) throw new Error("Enter an amount first.");

        setPhase("swapping");
        const { txHash, settling } = await executeSwap(wallet, { side: "buy", symbol: asset.symbol, sellAmount });
        const confirmed = settling ? await settleRfq(txHash, setPhase, refreshBalances) : true;
        setResult({ txHash, asset, amountUsd, side: "buy", pending: !confirmed });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The buy didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, demo, refreshBalances],
  );

  /** Sell `amountIn` raw units (18dp) of a held `asset` back to USDG. */
  const sell = useCallback(
    async (params: { asset: Asset; amountIn: bigint; estUsdcValue: number }) => {
      const { asset, amountIn, estUsdcValue } = params;
      setError(null);
      setResult(null);
      if (demo) {
        setPhase("swapping");
        await sleep(1400);
        setResult({ txHash: DEMO_SWAP_TX, asset, amountUsd: estUsdcValue, side: "sell" });
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        if (amountIn <= BigInt(0)) throw new Error("Nothing to sell.");

        setPhase("swapping");
        const { txHash, settling } = await executeSwap(wallet, { side: "sell", symbol: asset.symbol, sellAmount: amountIn });
        const confirmed = settling ? await settleRfq(txHash, setPhase, refreshBalances) : true;
        setResult({ txHash, asset, amountUsd: estUsdcValue, side: "sell", pending: !confirmed });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The sell didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, demo, refreshBalances],
  );

  return {
    phase,
    error,
    result,
    busy: phase === "swapping" || phase === "settling",
    /** The trade is on-chain; we're waiting for the router's fill to unwrap. */
    settling: phase === "settling",
    buy,
    sell,
    reset,
  };
}
