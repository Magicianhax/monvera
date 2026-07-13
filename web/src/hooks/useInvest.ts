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
import { useSignTypedData } from "@privy-io/react-auth";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { sendSponsoredCalls, type Call } from "@/lib/aa";
import { buildUsdgPermitCall } from "@/lib/permit";
import { asViemProvider } from "@/lib/provider";
import { splitByWeights } from "@/lib/arcusShared";
import { fetchArcusQuote, settleCallFor, submitRfqIntent, typedDataSigner, type Eip1193 } from "@/lib/arcusTrade";
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
const MIN_LEG_MICRO = BigInt(11_000_000); // $11 — the RFQ floor (was $0.50, which let sub-min legs fail)

type Phase = "idle" | "thinking" | "planning" | "approving" | "investing" | "done" | "error";

/** "auto" = Vera signs silently; "manual" = the user approves each signature. */
export type InvestMode = "auto" | "manual";

/** Live per-leg progress, surfaced on the placing screen. */
export interface InvestProgress {
  total: number;
  done: number;
  currentSymbol: string | null;
  spentUsd: number;
  totalUsd: number;
  /** Estimated seconds remaining, refined after each leg. Null before the first completes. */
  etaSeconds: number | null;
  mode: InvestMode;
  /** Symbols that actually filled — so the conveyor only checks off real buys,
      never a leg that was attempted and failed. */
  filledSymbols: string[];
}

export interface UseInvest {
  phase: Phase;
  error: string | null;
  allocation: AllocateResult | null;
  success: InvestSuccess | null;
  progress: InvestProgress | null;
  busy: boolean;
  allocate: (goal: string, amountUsd: number, riskTolerance?: string) => Promise<AllocateResult | null>;
  invest: (allocation: Allocation, amountUsd: number, address: string, mode?: InvestMode) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  // Long calls (allocate runs ~20s of inference) are a big window for a network
  // blip — a VPN reconnect makes the browser kill every in-flight request with
  // a bare TypeError ("Failed to fetch") even though the server finishes fine.
  // Retry once on that transport-level failure; HTTP errors are never retried.
  let res: Response;
  try {
    res = await postOnce(url, body);
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    try {
      res = await postOnce(url, body);
    } catch {
      throw new Error("Connection dropped mid-request. Check your network and try again.");
    }
  }
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Something went wrong.");
  }
  return json as T;
}

async function postOnce(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
}

export function useInvest(): UseInvest {
  const demo = useDemo();
  const activeWallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const { signTypedData } = useSignTypedData();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<AllocateResult | null>(null);
  const [success, setSuccess] = useState<InvestSuccess | null>(null);
  const [progress, setProgress] = useState<InvestProgress | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setAllocation(null);
    setSuccess(null);
    setProgress(null);
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
    async (alloc: Allocation, amountUsd: number, _address: string, mode: InvestMode = "auto") => {
      setError(null);
      setProgress(null);
      // Demo: walk the placing phases on a timer with fake per-leg progress.
      if (demo) {
        setPhase("planning");
        await sleep(900);
        setPhase("investing");
        const dLegs = alloc.allocations.filter((a) => a.weightPct > 0);
        for (let i = 0; i < dLegs.length; i++) {
          setProgress({
            total: dLegs.length,
            done: i,
            currentSymbol: dLegs[i].symbol,
            spentUsd: (amountUsd * i) / dLegs.length,
            totalUsd: amountUsd,
            etaSeconds: (dLegs.length - i) * 2,
            mode,
            filledSymbols: dLegs.slice(0, i).map((a) => a.symbol),
          });
          await sleep(700);
        }
        setSuccess(demo.success(alloc, amountUsd));
        setPhase("done");
        setProgress(null);
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

        // 2. One firm Arcus quote per leg (taker = the embedded EOA). The plan
        // is pre-screened for liquidity, but a maker can pull between showing the
        // plan and tapping invest: skip a leg that lost liquidity and buy the
        // rest, rather than failing the whole basket. Other errors still throw.
        setPhase("planning");
        const quotes = [];
        for (let i = 0; i < legs.length; i++) {
          if (legAmounts[i] <= BigInt(0)) continue;
          try {
            const quote = await fetchArcusQuote({
              side: "buy",
              symbol: legs[i].symbol,
              sellAmount: legAmounts[i],
              taker: eoa,
            });
            // Keep BOTH venues now that we settle one leg per UserOp: "tx" legs
            // relay [permit?, settle] through Pimlico; "rfq" legs are submitted to
            // the router (which settles them, off Pimlico, minutes later). Only a
            // genuinely illiquid leg is dropped. (Previously rfq legs were skipped
            // for batching — which silently dropped most stocks from a plan.)
            quotes.push({ leg: legs[i], amountMicro: legAmounts[i], quote });
          } catch (e) {
            if (e instanceof Error && /no liquidity/i.test(e.message)) continue;
            throw e;
          }
        }
        if (quotes.length === 0) throw new Error("No tradable holdings in this plan.");

        // 3. Settle ONE leg per UserOp (mirrors the manual buy path). Batching
        //    multiple Arcus RFQ settles into a single UserOp reverts with the
        //    router's InvalidAction() guard, so each leg gets its own sponsored
        //    UserOp. Each leg is best-effort: a bad leg is skipped and the rest
        //    still invest, rather than failing the whole plan.
        setPhase("approving");
        const provider = (await wallet.getEthereumProvider()) as Eip1193;
        // AUTO: sign silently (embedded-wallet default). MANUAL: route each
        // signature through Privy's UI so the user approves it explicitly.
        const signTyped =
          mode === "manual"
            ? (json: string) =>
                signTypedData(JSON.parse(json), { uiOptions: { showWalletUIs: true }, address: eoa }).then(
                  (r) => r.signature as `0x${string}`,
                )
            : typedDataSigner(provider, eoa);
        const viemProvider = asViemProvider(provider);

        const relay = async (call: Call): Promise<`0x${string}`> => {
          const r = await sendSponsoredCalls(viemProvider, [call]);
          if (!r.success) throw new Error(`reverted (tx ${r.receipt.transactionHash})`);
          return r.receipt.transactionHash as `0x${string}`;
        };

        // One-time USDG -> Permit2 allowance, its own UserOp.
        const first = quotes[0].quote;
        if (first.needsAllowance && first.permit2) {
          await relay(await buildUsdgPermitCall(signTyped, eoa, first.permit2));
        }

        setPhase("investing");
        const filled: { leg: (typeof quotes)[number]["leg"]; amountMicro: bigint; txHash: `0x${string}`; settling: boolean }[] = [];
        const filledSyms: string[] = [];
        let lastTx: `0x${string}` | null = null;
        const total = quotes.length;
        const startedAt = Date.now();
        let spentMicroRunning = BigInt(0);
        for (let idx = 0; idx < quotes.length; idx++) {
          const q = quotes[idx];
          // Mark this leg as in-flight so the placing screen names it.
          setProgress({
            total,
            done: idx,
            currentSymbol: q.leg.symbol,
            spentUsd: Number(spentMicroRunning) / 1_000_000,
            totalUsd: amountUsd,
            etaSeconds: idx === 0 ? total * 6 : Math.ceil(((Date.now() - startedAt) / 1000 / idx) * (total - idx)),
            mode,
            filledSymbols: [...filledSyms],
          });
          try {
            // Settle by venue: "rfq" legs go to the router (settles off-Pimlico,
            // minutes later); "tx" legs relay [settle] through Pimlico now.
            let legTx: `0x${string}`;
            let settling = false;
            if (q.quote.kind === "rfq") {
              const submitted = await submitRfqIntent(q.quote, eoa, signTyped);
              legTx = submitted.txHash;
              settling = true;
            } else {
              legTx = await relay(await settleCallFor(q.quote, signTyped));
            }
            lastTx = legTx;
            filled.push({ leg: q.leg, amountMicro: q.amountMicro, txHash: legTx, settling });
            filledSyms.push(q.leg.symbol);
            spentMicroRunning += q.amountMicro;
          } catch (legErr) {
            console.error(`[invest] leg ${q.leg.symbol} failed:`, legErr instanceof Error ? legErr.message : legErr);
          }
          const doneCount = idx + 1;
          const perLeg = (Date.now() - startedAt) / 1000 / doneCount;
          setProgress({
            total,
            done: doneCount,
            currentSymbol: doneCount < total ? quotes[doneCount].leg.symbol : null,
            spentUsd: Number(spentMicroRunning) / 1_000_000,
            totalUsd: amountUsd,
            etaSeconds: doneCount < total ? Math.ceil(perLeg * (total - doneCount)) : 0,
            mode,
            filledSymbols: [...filledSyms],
          });
        }
        if (filled.length === 0) {
          setProgress(null);
          throw new Error("The investment didn't go through. No funds were moved.");
        }

        // 3b. The trust layer: Vera signs the risk inference server-side and the
        // VeraRecord contract records it as a final, separate UserOp over what
        // ACTUALLY filled. Best-effort: a failed record never undoes real buys.
        const spentMicro = filled.reduce((s, l) => s + l.amountMicro, BigInt(0));
        let commit: CommitPlan | null = null;
        let recordTx: `0x${string}` | null = null;
        if (INFERENCE_VERIFIER.toLowerCase() !== zeroAddress) {
          try {
            commit = await postJson<CommitPlan>("/api/commit-plan", {
              address: eoa,
              allocation: alloc,
              amountUsd,
            });
            recordTx = await relay({
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
                  spentMicro,
                  BigInt(filled.length),
                ],
              }),
            });
          } catch (recErr) {
            console.error("[invest] record failed (buys succeeded):", recErr instanceof Error ? recErr.message : recErr);
            commit = null;
          }
        }

        const holdings = filled.map(({ leg, amountMicro, txHash }) => ({
          symbol: leg.symbol,
          name: leg.symbol,
          weightPct: leg.weightPct,
          amountUsd: Number(amountMicro) / 1_000_000,
          txHash,
        }));

        setSuccess({
          // Top-level link = the on-chain plan record when it ran, else last buy.
          txHash: (recordTx ?? lastTx ?? "0x") as `0x${string}`,
          holdings,
          amountUsd: Number(spentMicro) / 1_000_000,
          anySettling: filled.some((f) => f.settling),
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
        setProgress(null);
        refreshBalances(); // cash + holdings + activity refetch now, no manual refresh
      } catch (e) {
        setError(e instanceof Error ? e.message : "The investment didn't go through.");
        setPhase("error");
        setProgress(null);
      }
    },
    [demo, activeWallet, refreshBalances, signTypedData],
  );

  return {
    phase,
    error,
    allocation,
    success,
    progress,
    busy: phase === "thinking" || phase === "planning" || phase === "approving" || phase === "investing",
    allocate,
    invest,
    reset,
    clearError,
  };
}
