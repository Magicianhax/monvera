"use client";

// useInvest — the heart of the Lite happy-path.
//
//   allocate(goal, amount) -> Vera builds an allocation (POST /api/allocate,
//                             served by Virtuals inference credits)
//   invest(allocation, ...) -> the basket executes through the Arcus spot RFQ:
//     1. split the USDG amount across the legs by weight (exact, 6dp)
//     2. one firm quote per leg (POST /api/quote, taker = the embedded EOA)
//     3. the EOA signs each leg's Permit2 intent (+ one gasless USDG permit if
//        the Permit2 allowance isn't in place yet)
//     4. ONE batched, gas-sponsored UserOp relays [permit?, settle1..settleN]
//
// No platform fee — Arcus's fee is inside each quote and our referral code is
// attached server-side. No executor contract: settlement is per-leg RFQ.
import { useCallback, useState } from "react";
import { encodeFunctionData, zeroAddress } from "viem";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { buildUsdgPermitCall } from "@/lib/permit";
import { asViemProvider } from "@/lib/provider";
import { splitByWeights } from "@/lib/arcusShared";
import { fetchArcusQuote, settleCallFor, typedDataSigner, type Eip1193 } from "@/lib/arcusTrade";
import { VERA_RECORD_ABI } from "@/lib/abis";
import { INFERENCE_VERIFIER } from "@/lib/tokens";
import { useDemo } from "@/components/demo/DemoProvider";
import { useRefreshBalances } from "@/hooks/useBalances";
import { authHeader } from "@/lib/authedFetch";
import type { Allocation } from "@/lib/allocation-schema";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";

/** POST /api/commit-plan response — Vera's signed risk inference for this plan. */
interface CommitPlan {
  planId: `0x${string}`;
  recHash: `0x${string}`;
  assessedRisk: number;
  maxRisk: number;
  expiry: string;
  signature: `0x${string}`;
  agentId: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Below ~$0.50 a leg, RFQ quotes get unreliable and the fill is all spread.
const MIN_LEG_MICRO = BigInt(500_000);

type Phase = "idle" | "thinking" | "planning" | "approving" | "investing" | "done" | "error";

export interface UseInvest {
  phase: Phase;
  error: string | null;
  allocation: AllocateResult | null;
  success: InvestSuccess | null;
  busy: boolean;
  allocate: (goal: string, amountUsd: number, riskTolerance?: string) => Promise<AllocateResult | null>;
  invest: (allocation: Allocation, amountUsd: number, address: string) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Something went wrong.");
  }
  return json as T;
}

export function useInvest(): UseInvest {
  const demo = useDemo();
  const activeWallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<AllocateResult | null>(null);
  const [success, setSuccess] = useState<InvestSuccess | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setAllocation(null);
    setSuccess(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const allocate = useCallback(
    async (goal: string, amountUsd: number, riskTolerance?: string) => {
      setError(null);
      setSuccess(null);
      setPhase("thinking");
      // Demo: canned plan after a believable "thinking" beat, no AI call.
      if (demo) {
        await sleep(1100);
        const result = demo.allocate(goal, amountUsd, riskTolerance);
        setAllocation(result);
        setPhase("idle");
        return result;
      }
      try {
        const result = await postJson<AllocateResult>("/api/allocate", {
          goal,
          amountUsd,
          riskTolerance,
        });
        setAllocation(result);
        setPhase("idle");
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Vera couldn't build a plan.");
        setPhase("error");
        return null;
      }
    },
    [demo],
  );

  const invest = useCallback(
    async (alloc: Allocation, amountUsd: number, _address: string) => {
      setError(null);
      // Demo: walk the placing phases on a timer, then a canned success.
      if (demo) {
        setPhase("planning");
        await sleep(900);
        setPhase("investing");
        await sleep(1500);
        setSuccess(demo.success(alloc, amountUsd));
        setPhase("done");
        return;
      }
      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const eoa = wallet.address as `0x${string}`;

        // 1. Split the gross USDG (6dp) across legs by weight — sums exactly.
        const grossMicro = BigInt(Math.round(amountUsd * 1_000_000));
        const legs = alloc.allocations.filter((a) => a.weightPct > 0);
        const legAmounts = splitByWeights(grossMicro, legs.map((a) => a.weightPct));
        if (legAmounts.some((v) => v > BigInt(0) && v < MIN_LEG_MICRO)) {
          throw new Error(
            `That amount is too small to split across ${legs.length} holdings — try at least $${(legs.length * 0.5).toFixed(0) || 1}, or a simpler plan.`,
          );
        }

        // 2. One firm Arcus quote per leg (taker = the embedded EOA).
        setPhase("planning");
        const quotes = [];
        for (let i = 0; i < legs.length; i++) {
          if (legAmounts[i] <= BigInt(0)) continue;
          quotes.push({
            leg: legs[i],
            amountMicro: legAmounts[i],
            quote: await fetchArcusQuote({
              side: "buy",
              symbol: legs[i].symbol,
              sellAmount: legAmounts[i],
              taker: eoa,
            }),
          });
        }
        if (quotes.length === 0) throw new Error("No tradable holdings in this plan.");

        // 3. Sign every leg's Permit2 intent (+ one gasless USDG permit if needed).
        setPhase("approving");
        const provider = (await wallet.getEthereumProvider()) as Eip1193;
        const signTyped = typedDataSigner(provider, eoa);

        const calls: Call[] = [];
        const first = quotes[0].quote;
        if (first.needsAllowance && first.permit2) {
          calls.push(await buildUsdgPermitCall(signTyped, eoa, first.permit2));
        }
        for (const q of quotes) {
          calls.push(await settleCallFor(q.quote, signTyped));
        }

        // 3b. The trust layer: Vera signs the risk inference server-side, and the
        // VeraRecord contract verifies + records it in the SAME batch as the
        // buys — atomic, on-chain, uneditable. Skipped gracefully if the record
        // contract isn't deployed (env zero) so trading never blocks on it.
        let commit: CommitPlan | null = null;
        if (INFERENCE_VERIFIER.toLowerCase() !== zeroAddress) {
          commit = await postJson<CommitPlan>("/api/commit-plan", {
            address: eoa,
            allocation: alloc,
            amountUsd,
          });
          calls.push({
            to: INFERENCE_VERIFIER,
            data: encodeFunctionData({
              abi: VERA_RECORD_ABI,
              functionName: "record",
              args: [
                commit.planId,
                commit.recHash,
                commit.assessedRisk,
                commit.maxRisk,
                BigInt(commit.expiry),
                commit.signature,
                eoa,
                BigInt(commit.agentId),
                grossMicro,
                BigInt(quotes.length),
              ],
            }),
          });
        }

        // 4. One batched, sponsored UserOp settles the whole basket + record.
        setPhase("investing");
        const receipt = await sendSponsoredCalls(asViemProvider(provider), calls);

        const holdings = quotes.map(({ leg, amountMicro }) => ({
          symbol: leg.symbol,
          name: leg.symbol,
          weightPct: leg.weightPct,
          amountUsd: Number(amountMicro) / 1_000_000,
        }));

        setSuccess({
          txHash: receipt.receipt.transactionHash as `0x${string}`,
          holdings,
          amountUsd,
          verification: commit
            ? {
                riskScore: commit.assessedRisk,
                maxRisk: commit.maxRisk,
                planId: commit.planId,
                agentId: commit.agentId,
                signature: commit.signature,
              }
            : undefined,
        });
        setPhase("done");
        refreshBalances(); // cash + holdings + activity refetch now, no manual refresh
      } catch (e) {
        setError(e instanceof Error ? e.message : "The investment didn't go through.");
        setPhase("error");
      }
    },
    [demo, activeWallet, refreshBalances],
  );

  return {
    phase,
    error,
    allocation,
    success,
    busy: phase === "thinking" || phase === "planning" || phase === "approving" || phase === "investing",
    allocate,
    invest,
    reset,
    clearError,
  };
}
