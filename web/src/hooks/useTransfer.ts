"use client";

// useTransfer — send a held token to any address, gasless.
//
// The user's funds live in the Privy embedded EOA (see useSmartAccount — the
// EOA is the address we show, fund, and trade from). The relaying smart
// account holds NOTHING, so a naive `token.transfer` from it reverts with an
// opaque bundler error. The working shape mirrors the invest rails: the EOA
// signs an exact-amount EIP-2612 permit for the smart account, and ONE
// sponsored UserOp relays [permit, transferFrom(EOA -> recipient)] — funds
// move straight from the EOA, the user never needs gas, and no standing
// allowance is left behind. Demo mode never touches the chain.
import { useCallback, useState } from "react";
import { encodeFunctionData, isAddress } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { getSmartAccountClient, sendSponsoredCalls, type Call } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { buildPermitCall } from "@/lib/permit";
import { typedDataSigner, type Eip1193 } from "@/lib/arcusTrade";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { explainError } from "@/lib/explainError";

type Phase = "idle" | "sending" | "done" | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Canned receipt hash for demo-mode sends (never broadcast on-chain).
const DEMO_TX = ("0x" + "5e9d1c30".repeat(32).slice(0, 64)) as `0x${string}`;

const TRANSFER_FROM_ABI = [
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;


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
        const eoa = wallet.address as `0x${string}`;

        setPhase("sending");
        const provider = await wallet.getEthereumProvider();
        const viemProvider = asViemProvider(provider);
        // The relaying smart account — the permit's spender, so transferFrom
        // succeeds when the UserOp executes it.
        const { owner: relayer } = await getSmartAccountClient(viemProvider);
        const signTyped = typedDataSigner(provider as Eip1193, eoa);

        // Exact-amount permit: fully consumed by this send, no allowance lingers.
        const permitCall = await buildPermitCall(signTyped, eoa, relayer, token, amountRaw);
        const transferFromCall: Call = {
          to: token,
          data: encodeFunctionData({
            abi: TRANSFER_FROM_ABI,
            functionName: "transferFrom",
            args: [eoa, to as `0x${string}`, amountRaw],
          }),
        };

        const r = await sendSponsoredCalls(viemProvider, [permitCall, transferFromCall]);
        if (!r.success) throw new Error(`reverted (tx ${r.receipt.transactionHash})`);
        setResult({
          txHash: r.receipt.transactionHash as `0x${string}`,
          symbol,
          amount,
          to,
        });
        setPhase("done");
        refreshBalances(); // reflect the lower balance immediately
      } catch (e) {
        console.error("[transfer]", e);
        setError(explainError(e));
        setPhase("error");
      }
    },
    [activeWallet, demo, refreshBalances],
  );

  return { phase, error, result, busy: phase === "sending", send, reset };
}
