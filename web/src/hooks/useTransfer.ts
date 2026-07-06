"use client";

// useTransfer — send a held token out of the smart account to any address, as a
// single gasless UserOp: [ token.transfer(to, amount) ]. Works for USDC and any
// xStock the user holds. Demo mode never touches the chain.
import { useCallback, useState } from "react";
import { encodeFunctionData, isAddress } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { ERC20_ABI } from "@/lib/abis";

type Phase = "idle" | "sending" | "done" | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode sends (never broadcast on-chain).
const DEMO_TX = ("0x" + "5e9d1c30".repeat(32).slice(0, 64)) as `0x${string}`;

export interface TransferResult {
  txHash: `0x${string}`;
  symbol: string;
  amount: number;
  to: string;
}

export function useTransfer() {
  const activeWallet = useActiveWallet();
  const demo = useDemo();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  /** Send `amountRaw` (token base units) of `token` to `to`. `amount`/`symbol` are for the receipt. */
  const send = useCallback(
    async (params: {
      token: `0x${string}`;
      to: string;
      amountRaw: bigint;
      amount: number;
      symbol: string;
    }) => {
      const { token, to, amountRaw, amount, symbol } = params;
      setError(null);
      setResult(null);

      // Validate before any chain/demo work.
      if (!isAddress(to)) {
        setError("That doesn't look like a valid wallet address.");
        setPhase("error");
        return;
      }
      if (amountRaw <= BigInt(0)) {
        setError("Enter an amount to send.");
        setPhase("error");
        return;
      }

      // Demo mode: simulate a successful send without touching the chain.
      if (demo) {
        setPhase("sending");
        await sleep(1400);
        setResult({ txHash: DEMO_TX, symbol, amount, to });
        setPhase("done");
        return;
      }

      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");

        const transferCall: Call = {
          to: token,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [to as `0x${string}`, amountRaw],
          }),
        };

        setPhase("sending");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const receipt = await sendSponsoredCalls(provider, [transferCall]);
        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          symbol,
          amount,
          to,
        });
        setPhase("done");
        refreshBalances(); // reflect the lower balance immediately
      } catch (e) {
        setError(e instanceof Error ? e.message : "The transfer didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, demo, refreshBalances],
  );

  return { phase, error, result, busy: phase === "sending", send, reset };
}
