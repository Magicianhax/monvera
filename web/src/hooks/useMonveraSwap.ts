"use client";

// useMonveraSwap — buy/sell $MONVERA with the app's EXISTING gasless machinery.
// The trading EOA stays a plain EOA forever (owner rule: nothing may perturb
// the Arcus RWA flows — no 7702, no delegation).
//
// BUY (fully gasless, same pattern as every stock buy): one sponsored UserOp —
//   [ USDG.permit(EOA->SA, EXACT amount — user signs it in Privy's wallet UI,
//     so every purchase is explicitly approved), USDG.transferFrom(EOA->SA),
//     USDG.approve(quote.approvalAddress), quote.tx (toAddress = EOA) ]
// SELL (gasless-feeling): MONVERA has no EIP-2612, so the FIRST sell bootstraps
// a one-time EOA approve(smartAccount, max) paid by /api/gas-drip dust — shown
// in Privy's confirm UI, never silent; every sell then relays
// [ transferFrom(EOA->SA), approve(spender), quote.tx ] as one sponsored
// UserOp. Routing = /api/token-quote (best of Matcha/0x vs direct v2 router).
import { useCallback, useState } from "react";
import { encodeFunctionData, maxUint256 } from "viem";
import { useSignTypedData, useSendTransaction } from "@privy-io/react-auth";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { getSmartAccountClient, sendSponsoredCalls, type Call } from "@/lib/aa";
import { buildPermitCall } from "@/lib/permit";
import { type Eip1193 } from "@/lib/arcusTrade";
import { asViemProvider } from "@/lib/provider";
import { publicClient } from "@/lib/wagmi";
import { useRefreshBalances } from "@/hooks/useBalances";
import { authHeader } from "@/lib/authedFetch";
import { USDG } from "@/lib/tokens";
import { MONVERA, ERC20_MINI_ABI } from "@/lib/monveraToken";
import { explainError } from "@/lib/explainError";

type Phase = "idle" | "quoting" | "preparing" | "swapping" | "done" | "error";

export interface MonveraSwapResult {
  txHash: `0x${string}`;
  side: "buy" | "sell";
  /** What was paid (raw: USDG 6dp on buy, MONVERA 18dp on sell). */
  amountIn: bigint;
  /** Expected received per the executed quote (raw; actual fill within slippage). */
  amountOut: bigint;
  /** Guaranteed-minimum received (raw MONVERA on buy, raw USDG on sell). */
  minOut: bigint;
}

interface TokenQuote {
  toAmount: string;
  toAmountMin: string;
  approvalAddress: `0x${string}`;
  tx: { to: `0x${string}`; data: `0x${string}`; value: string };
  source: "matcha" | "router";
  /** matcha only: forwards the swap output from the smart account to the EOA. */
  sweepTx?: { to: `0x${string}`; data: `0x${string}`; value: string };
}

/** `address` = the smart account that executes; `to` = the EOA that receives. */
async function fetchQuote(
  side: "buy" | "sell",
  amountRaw: bigint,
  address: string,
  to: string,
  prefer?: "router",
): Promise<TokenQuote> {
  const preferQ = prefer ? `&prefer=${prefer}` : "";
  const res = await fetch(`/api/token-quote?side=${side}&amount=${amountRaw}&address=${address}&to=${to}${preferQ}`);
  const json = await res.json();
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't get a quote.");
  return json as TokenQuote;
}

export function useMonveraSwap() {
  const activeWallet = useActiveWallet();
  const { signTypedData } = useSignTypedData();
  const { sendTransaction } = useSendTransaction();
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
        if (!wallet) throw new Error("Sign in to trade $MONVERA.");
        const eoa = wallet.address as `0x${string}`;
        const amountIn = BigInt(Math.round(usdAmount * 1_000_000)); // USDG 6dp
        if (amountIn <= BigInt(0)) throw new Error("Enter an amount first.");

        setPhase("quoting");
        const rawProvider = (await wallet.getEthereumProvider()) as Eip1193;
        const provider = asViemProvider(rawProvider);
        const { owner: smartAccount } = await getSmartAccountClient(provider);

        // EXACT-amount EIP-2612 permit, signed through Privy's wallet UI: the
        // user sees and approves precisely this purchase's USDG — no silent,
        // no unlimited allowance. Every buy prompts.
        const promptSigner = (json: string) =>
          signTypedData(JSON.parse(json), { uiOptions: { showWalletUIs: true }, address: eoa }).then(
            (r) => r.signature as `0x${string}`,
          );
        const permitCall = await buildPermitCall(promptSigner, eoa, smartAccount, USDG.address as `0x${string}`, amountIn);

        const buildCalls = (q: TokenQuote): Call[] => [
          permitCall,
          {
            to: USDG.address as `0x${string}`,
            data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "transferFrom", args: [eoa, smartAccount, amountIn] }),
          },
          {
            to: USDG.address as `0x${string}`,
            data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "approve", args: [q.approvalAddress, amountIn] }),
          },
          { to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value || 0) },
          ...(q.sweepTx ? [{ to: q.sweepTx.to, data: q.sweepTx.data, value: BigInt(q.sweepTx.value || 0) }] : []),
        ];

        // Balance backstop: a UserOp that "succeeds" only proves it didn't
        // revert — not that MONVERA actually arrived. Snapshot before, and after
        // require the delta to clear the quote's min-out, so a manipulated quote
        // that pulls the approved USDG without delivering can't report success.
        const monveraBefore = (await publicClient.readContract({
          address: MONVERA.address,
          abi: ERC20_MINI_ABI,
          functionName: "balanceOf",
          args: [eoa],
        })) as bigint;

        const q = await fetchQuote("buy", amountIn, smartAccount, eoa);
        setPhase("swapping");
        let receipt, executed;
        try {
          receipt = await sendSponsoredCalls(provider, buildCalls(q));
          executed = q;
        } catch (err) {
          // Matcha routes occasionally revert in simulation (executor quirks on
          // this young chain). The direct v2 router path is the designed
          // fallback — re-quote and retry once before surfacing anything.
          if (q.source !== "matcha") throw err;
          console.warn("[monvera-swap] Matcha buy route reverted, retrying via router:", err instanceof Error ? err.message : err);
          const rq = await fetchQuote("buy", amountIn, smartAccount, eoa, "router");
          receipt = await sendSponsoredCalls(provider, buildCalls(rq));
          executed = rq;
        }

        const monveraAfter = (await publicClient.readContract({
          address: MONVERA.address,
          abi: ERC20_MINI_ABI,
          functionName: "balanceOf",
          args: [eoa],
        })) as bigint;
        if (monveraAfter - monveraBefore < BigInt(executed.toAmountMin)) {
          throw new Error("The swap didn't deliver the expected $MONVERA. No funds were lost — please try again.");
        }

        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          side: "buy",
          amountIn,
          amountOut: BigInt(executed.toAmount),
          minOut: BigInt(executed.toAmountMin),
        });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(explainError(e));
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
        if (!wallet) throw new Error("Sign in to trade $MONVERA.");
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
          // The approve is shown in Privy's confirm UI (never silent) — the one
          // on-chain tx the EOA ever pays itself, funded by the drip above.
          const approveTx = await sendTransaction(
            {
              to: MONVERA.address,
              data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "approve", args: [smartAccount, maxUint256] }),
            },
            { uiOptions: { showWalletUIs: true }, address: eoa },
          );
          await publicClient.waitForTransactionReceipt({ hash: approveTx.hash as `0x${string}` });
        }

        const buildCalls = (quote: TokenQuote): Call[] => [
          {
            to: MONVERA.address,
            data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "transferFrom", args: [eoa, smartAccount, amountRaw] }),
          },
          {
            to: MONVERA.address,
            data: encodeFunctionData({ abi: ERC20_MINI_ABI, functionName: "approve", args: [quote.approvalAddress, amountRaw] }),
          },
          { to: quote.tx.to, data: quote.tx.data, value: BigInt(quote.tx.value || 0) },
          ...(quote.sweepTx ? [{ to: quote.sweepTx.to, data: quote.sweepTx.data, value: BigInt(quote.sweepTx.value || 0) }] : []),
        ];

        // USDG-received backstop (same rationale as the buy path).
        const usdgBefore = (await publicClient.readContract({
          address: USDG.address as `0x${string}`,
          abi: ERC20_MINI_ABI,
          functionName: "balanceOf",
          args: [eoa],
        })) as bigint;

        setPhase("swapping");
        let receipt, executed;
        try {
          receipt = await sendSponsoredCalls(provider, buildCalls(q));
          executed = q;
        } catch (err) {
          // Same Matcha-revert fallback as the buy path: re-quote via the direct
          // v2 router and retry once.
          if (q.source !== "matcha") throw err;
          console.warn("[monvera-swap] Matcha sell route reverted, retrying via router:", err instanceof Error ? err.message : err);
          const rq = await fetchQuote("sell", amountRaw, smartAccount, eoa, "router");
          receipt = await sendSponsoredCalls(provider, buildCalls(rq));
          executed = rq;
        }

        const usdgAfter = (await publicClient.readContract({
          address: USDG.address as `0x${string}`,
          abi: ERC20_MINI_ABI,
          functionName: "balanceOf",
          args: [eoa],
        })) as bigint;
        if (usdgAfter - usdgBefore < BigInt(executed.toAmountMin)) {
          throw new Error("The swap didn't deliver the expected USDG. No funds were lost — please try again.");
        }

        setResult({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          side: "sell",
          amountIn: amountRaw,
          amountOut: BigInt(executed.toAmount),
          minOut: BigInt(executed.toAmountMin),
        });
        setPhase("done");
        refreshBalances();
      } catch (e) {
        setError(explainError(e));
        setPhase("error");
      }
    },
    [activeWallet, refreshBalances],
  );

  return { phase, error, result, busy: phase !== "idle" && phase !== "done" && phase !== "error", quoteOut, buy, sell, reset };
}
