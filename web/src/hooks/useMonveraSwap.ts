"use client";

// useMonveraSwap — buy/sell $MONVERA with the app's EXISTING gasless machinery.
// The trading EOA stays a plain EOA forever (owner rule: nothing may perturb
// the Arcus RWA flows — no 7702, no delegation).
//
// BUY (fully gasless, same pattern as every stock buy): one sponsored UserOp —
//   [ USDG.permit(EOA->SA, if allowance short), USDG.transferFrom(EOA->SA),
//     USDG.approve(quote.approvalAddress), quote.tx (toAddress = EOA) ]
// SELL (gasless-feeling): MONVERA has no EIP-2612, so the FIRST sell bootstraps
// a one-time EOA approve(smartAccount, max) paid by /api/gas-drip dust; every
// sell then relays [ transferFrom(EOA->SA), approve(spender), quote.tx ] as one
// sponsored UserOp. Routing = /api/token-quote (LiFi best-rate, v2 fallback).
import { useCallback, useState } from "react";
import { encodeFunctionData, maxUint256 } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { getSmartAccountClient, sendSponsoredCalls, type Call } from "@/lib/aa";
import { buildPermitCall } from "@/lib/permit";
import { typedDataSigner, type Eip1193 } from "@/lib/arcusTrade";
import { asViemProvider } from "@/lib/provider";
import { publicClient } from "@/lib/wagmi";
import { useRefreshBalances } from "@/hooks/useBalances";
import { authHeader } from "@/lib/authedFetch";
import { USDG } from "@/lib/tokens";
import { MONVERA, ERC20_MINI_ABI } from "@/lib/monveraToken";

type Phase = "idle" | "quoting" | "preparing" | "swapping" | "done" | "error";

export interface MonveraSwapResult {
  txHash: `0x${string}`;
  side: "buy" | "sell";
  /** Guaranteed-minimum received (raw MONVERA on buy, raw USDG on sell). */
  minOut: bigint;
}

interface TokenQuote {
  toAmount: string;
  toAmountMin: string;
  approvalAddress: `0x${string}`;
  tx: { to: `0x${string}`; data: `0x${string}`; value: string };
  source: "lifi" | "router";
}

/** `address` = the smart account that executes; `to` = the EOA that receives. */
async function fetchQuote(side: "buy" | "sell", amountRaw: bigint, address: string, to: string): Promise<TokenQuote> {
  const res = await fetch(`/api/token-quote?side=${side}&amount=${amountRaw}&address=${address}&to=${to}`);
  const json = await res.json();
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't get a quote.");
  return json as TokenQuote;
}

export function useMonveraSwap() {
  const activeWallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MonveraSwapResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  /** Preview only — expected out (raw) for the amount panel. */
  const quoteOut = useCallback(
    async (side: "buy" | "sell", amountIn: bigint): Promise<bigint> => {
      const wallet = activeWallet;
      if (!wallet || amountIn <= BigInt(0)) return BigInt(0);
      const provider = asViemProvider((await wallet.getEthereumProvider()) as Eip1193);
      const { owner: smartAccount } = await getSmartAccountClient(provider);
      const q = await fetchQuote(side, amountIn, smartAccount, wallet.address);
      return BigInt(q.toAmount);
    },
    [activeWallet],
  );

  /** Buy `usdAmount` dollars of MONVERA — fully gasless, tokens land in the EOA. */
  const buy = useCallback(
    async (usdAmount: number) => {
      setError(null);
      setResult(null);
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const eoa = wallet.address as `0x${string}`;
        const amountIn = BigInt(Math.round(usdAmount * 1_000_000)); // USDG 6dp
        if (amountIn <= BigInt(0)) throw new Error("Enter an amount first.");

        setPhase("quoting");
        const rawProvider = (await wallet.getEthereumProvider()) as Eip1193;
        const provider = asViemProvider(rawProvider);
        const { owner: smartAccount } = await getSmartAccountClient(provider);
        const q = await fetchQuote("buy", amountIn, smartAccount, eoa);

        const calls: Call[] = [];
        const allowance = (await publicClient.readContract({
          address: USDG.address as `0x${string}`,
          abi: ERC20_MINI_ABI,
          functionName: "allowance",
          args: [eoa, smartAccount],
        })) as bigint;
        if (allowance < amountIn) {
          // Gasless EIP-2612: the EOA authorizes the smart account to pull USDG.
          calls.push(await buildPermitCall(typedDataSigner(rawProvider, eoa), eoa, smartAccount, USDG.address as `0x${string}`));
        }
        calls.push({
          to: USDG.address as `0x${string}`,
          data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "transferFrom", args: [eoa, smartAccount, amountIn] }),
        });
        calls.push({
          to: USDG.address as `0x${string}`,
          data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "approve", args: [q.approvalAddress, amountIn] }),
        });
        calls.push({ to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value || 0) });

        setPhase("swapping");
        const receipt = await sendSponsoredCalls(provider, calls);
        setResult({ txHash: receipt.receipt.transactionHash as `0x${string}`, side: "buy", minOut: BigInt(q.toAmountMin) });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The buy didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, refreshBalances],
  );

  /** Sell `amountRaw` MONVERA (18dp) back to USDG. First sell bootstraps via gas drip. */
  const sell = useCallback(
    async (amountRaw: bigint) => {
      setError(null);
      setResult(null);
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const eoa = wallet.address as `0x${string}`;
        if (amountRaw <= BigInt(0)) throw new Error("Nothing to sell.");

        setPhase("quoting");
        const rawProvider = (await wallet.getEthereumProvider()) as Eip1193;
        const provider = asViemProvider(rawProvider);
        const { owner: smartAccount } = await getSmartAccountClient(provider);
        const q = await fetchQuote("sell", amountRaw, smartAccount, eoa);

        // One-time bootstrap: the smart account needs pull-rights on MONVERA
        // (no EIP-2612 on the token). Drip covers the approve's gas.
        const allowance = (await publicClient.readContract({
          address: MONVERA.address,
          abi: ERC20_MINI_ABI,
          functionName: "allowance",
          args: [eoa, smartAccount],
        })) as bigint;
        if (allowance < amountRaw) {
          setPhase("preparing");
          const drip = await fetch("/api/gas-drip", { method: "POST", headers: await authHeader() });
          if (!drip.ok) {
            const j = await drip.json().catch(() => null);
            throw new Error(typeof j?.error === "string" ? j.error : "Couldn't prepare your wallet to sell. Try again.");
          }
          const approveHash = (await rawProvider.request({
            method: "eth_sendTransaction",
            params: [{
              from: eoa,
              to: MONVERA.address,
              data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "approve", args: [smartAccount, maxUint256] }),
            }],
          })) as `0x${string}`;
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        const calls: Call[] = [
          {
            to: MONVERA.address,
            data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "transferFrom", args: [eoa, smartAccount, amountRaw] }),
          },
          {
            to: MONVERA.address,
            data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "approve", args: [q.approvalAddress, amountRaw] }),
          },
          { to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value || 0) },
        ];

        setPhase("swapping");
        const receipt = await sendSponsoredCalls(provider, calls);
        setResult({ txHash: receipt.receipt.transactionHash as `0x${string}`, side: "sell", minOut: BigInt(q.toAmountMin) });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The sell didn't go through.");
        setPhase("error");
      }
    },
    [activeWallet, refreshBalances],
  );

  return { phase, error, result, busy: phase !== "idle" && phase !== "done" && phase !== "error", quoteOut, buy, sell, reset };
}
