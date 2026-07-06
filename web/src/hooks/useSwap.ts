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
import { fetchArcusQuote, settleCallFor, typedDataSigner, type Eip1193 } from "@/lib/arcusTrade";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { type Asset } from "@/lib/tokens";

type Phase = "idle" | "swapping" | "done" | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode buys/sells (never broadcast on-chain).
const DEMO_SWAP_TX = ("0x" + "5a7c2b41".repeat(32).slice(0, 64)) as `0x${string}`;

/**
 * Fetch a fresh quote, have the EOA sign the intent (+ USDG permit if needed),
 * and relay the settlement gaslessly. Returns the on-chain tx hash.
 */
async function executeSwap(
  wallet: NonNullable<ReturnType<typeof useActiveWallet>>,
  params: { side: "buy" | "sell"; symbol: string; sellAmount: bigint },
): Promise<`0x${string}`> {
  const eoa = wallet.address as `0x${string}`;
  const quote = await fetchArcusQuote({ ...params, taker: eoa });

  const provider = (await wallet.getEthereumProvider()) as Eip1193;
  const signTyped = typedDataSigner(provider, eoa);

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
  return receipt.receipt.transactionHash as `0x${string}`;
}

export interface SwapResult {
  txHash: `0x${string}`;
  asset: Asset;
  amountUsd: number;
  /** "buy" (USDG -> asset) or "sell" (asset -> USDG). */
  side: "buy" | "sell";
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
        const txHash = await executeSwap(wallet, { side: "buy", symbol: asset.symbol, sellAmount });
        setResult({ txHash, asset, amountUsd, side: "buy" });
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
        const txHash = await executeSwap(wallet, { side: "sell", symbol: asset.symbol, sellAmount: amountIn });
        setResult({ txHash, asset, amountUsd: estUsdcValue, side: "sell" });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The sell didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, demo, refreshBalances],
  );

  return { phase, error, result, busy: phase === "swapping", buy, sell, reset };
}
