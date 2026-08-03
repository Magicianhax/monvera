"use client";

// useSellAll — sell some or all of your holdings in one flow, one gasless trade
// at a time. Mirrors useInvest: a per-leg loop (each sell is its own sponsored
// Arcus trade, since RFQ settles can't be batched), an auto/manual signer switch
// ("let Vera sell" vs "approve each step"), live progress, and per-holding tx
// receipts. Best-effort: a leg that fails is skipped so the rest still sell.
//
// Unlike a buy plan, most sells are RFQ-settled — the trade is submitted and
// on-chain immediately but the USDG proceeds unwrap a few minutes later. We
// record the submission honestly ("settling"), we don't block the whole flow
// waiting for each fill.
import { useCallback, useRef, useState } from "react";
import { useSignTypedData } from "@privy-io/react-auth";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useRefreshBalances } from "@/hooks/useBalances";
import { useDemo } from "@/components/demo/DemoProvider";
import { explainError, isUserRejection } from "@/lib/explainError";
import { executeSwap, type VenueName } from "@/hooks/useSwap";
import { typedDataSigner, waitForRfqFill, type Eip1193 } from "@/lib/arcusTrade";
import type { Asset } from "@/lib/tokens";
import type { InvestMode } from "@/hooks/useInvest";

/** One holding the user chose to sell, with how much (raw units) and its est. value. */
export interface SellSelection {
  asset: Asset;
  amountIn: bigint;
  estUsd: number;
}

export interface SellProgress {
  total: number;
  done: number;
  currentSymbol: string | null;
  proceedsUsd: number;
  totalUsd: number;
  etaSeconds: number | null;
  mode: InvestMode;
  /** Symbols actually sold — the conveyor only checks off real fills. */
  filledSymbols: string[];
  /** Which venue won each sold leg (symbol -> venue). */
  legVenues: Record<string, VenueName>;
}

export interface SoldHolding {
  symbol: string;
  name: string;
  amountUsd: number;
  txHash?: `0x${string}`;
  /** RFQ fill still unwrapping — proceeds land shortly, not instantly. */
  settling: boolean;
}

/** A leg that failed after its retry. Kept so the receipt can say so — a
 *  partial fill reported as a clean "Sold" is market exposure the user
 *  wrongly believes is closed. */
export interface FailedSell {
  symbol: string;
  name: string;
  amountUsd: number;
  message: string;
}

export interface SellSuccess {
  totalUsd: number;
  sold: SoldHolding[];
  /** Legs that did NOT sell (failed after retry). Empty on a clean fill. */
  failed: FailedSell[];
  anySettling: boolean;
}

type Phase = "idle" | "selling" | "done" | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const DEMO_TX = ("0x" + "5a7c2b41".repeat(32).slice(0, 64)) as `0x${string}`;

export function useSellAll() {
  const activeWallet = useActiveWallet();
  const demo = useDemo();
  const refreshBalances = useRefreshBalances();
  const { signTypedData } = useSignTypedData();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SellSuccess | null>(null);
  const [progress, setProgress] = useState<SellProgress | null>(null);
  // Set by stop() or by a declined signature; checked before each leg so the
  // run halts cleanly — what already sold stays sold and is reported honestly.
  const stopRef = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setSuccess(null);
    setProgress(null);
    stopRef.current = false;
  }, []);

  /** Ask the run to stop after the in-flight leg. */
  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const sellAll = useCallback(
    async (sels: SellSelection[], mode: InvestMode = "auto") => {
      setError(null);
      setSuccess(null);
      const totalUsd = sels.reduce((s, x) => s + x.estUsd, 0);

      if (demo) {
        setPhase("selling");
        for (let i = 0; i < sels.length; i++) {
          setProgress({
            total: sels.length,
            done: i,
            currentSymbol: sels[i].asset.symbol,
            proceedsUsd: (totalUsd * i) / sels.length,
            totalUsd,
            etaSeconds: (sels.length - i) * 2,
            mode,
            filledSymbols: sels.slice(0, i).map((s) => s.asset.symbol),
            legVenues: {},
          });
          await sleep(700);
        }
        setSuccess({
          totalUsd,
          anySettling: true,
          sold: sels.map((x) => ({ symbol: x.asset.symbol, name: x.asset.name, amountUsd: x.estUsd, txHash: DEMO_TX, settling: true })),
          failed: [],
        });
        setPhase("done");
        setProgress(null);
        return;
      }

      try {
        const wallet = activeWallet;
        if (!wallet) throw new Error("No account found. Please sign in again.");
        const eoa = wallet.address as `0x${string}`;
        const provider = (await wallet.getEthereumProvider()) as Eip1193;
        // AUTO: sign silently. MANUAL: each signature goes through Privy's UI.
        const signTyped =
          mode === "manual"
            ? (json: string) =>
                signTypedData(JSON.parse(json), { uiOptions: { showWalletUIs: true }, address: eoa }).then(
                  (r) => r.signature as `0x${string}`,
                )
            : typedDataSigner(provider, eoa);

        setPhase("selling");
        const sold: SoldHolding[] = [];
        const failed: FailedSell[] = [];
        const filledSyms: string[] = [];
        const legVenues: Record<string, VenueName> = {};
        const total = sels.length;
        const startedAt = Date.now();
        let proceeds = 0;
        stopRef.current = false;
        for (let idx = 0; idx < sels.length; idx++) {
          const sel = sels[idx];
          if (stopRef.current) {
            // User asked to stop (button or a declined signature): the rest is
            // recorded as not sold, never silently dropped.
            for (const rest of sels.slice(idx)) {
              failed.push({ symbol: rest.asset.symbol, name: rest.asset.name, amountUsd: rest.estUsd, message: "You stopped the run." });
            }
            break;
          }
          setProgress({
            total,
            done: idx,
            currentSymbol: sel.asset.symbol,
            proceedsUsd: proceeds,
            totalUsd,
            etaSeconds: idx === 0 ? total * 6 : Math.ceil(((Date.now() - startedAt) / 1000 / idx) * (total - idx)),
            mode,
            filledSymbols: [...filledSyms],
            legVenues: { ...legVenues },
          });
          try {
            const trade = { side: "sell" as const, symbol: sel.asset.symbol, sellAmount: sel.amountIn };
            let res: Awaited<ReturnType<typeof executeSwap>>;
            try {
              res = await executeSwap(wallet, trade, signTyped);
            } catch (firstErr) {
              // A declined signature is the user saying NO — stop the run, never
              // re-prompt them for the same trade they just refused.
              if (isUserRejection(firstErr)) {
                stopRef.current = true;
                throw firstErr;
              }
              // A maker can pull between quote and settle — executeSwap re-quotes
              // internally, so one retry recovers most transient failures.
              console.warn(`[sell-all] ${sel.asset.symbol} retrying:`, firstErr instanceof Error ? firstErr.message : firstErr);
              res = await executeSwap(wallet, trade, signTyped);
            }
            sold.push({ symbol: sel.asset.symbol, name: sel.asset.name, amountUsd: sel.estUsd, txHash: res.txHash, settling: res.settling });
            filledSyms.push(sel.asset.symbol);
            if (res.venue) legVenues[sel.asset.symbol] = res.venue;
            proceeds += sel.estUsd;
          } catch (legErr) {
            console.error(`[sell-all] ${sel.asset.symbol} failed (after retry):`, legErr instanceof Error ? legErr.message : legErr);
            // Best-effort continues, but the failure is RECORDED — the receipt
            // must never present a partial fill as a clean "Sold".
            failed.push({ symbol: sel.asset.symbol, name: sel.asset.name, amountUsd: sel.estUsd, message: explainError(legErr) });
          }
          const doneCount = idx + 1;
          const perLeg = (Date.now() - startedAt) / 1000 / doneCount;
          setProgress({
            total,
            done: doneCount,
            currentSymbol: doneCount < total ? sels[doneCount].asset.symbol : null,
            proceedsUsd: proceeds,
            totalUsd,
            etaSeconds: doneCount < total ? Math.ceil(perLeg * (total - doneCount)) : 0,
            mode,
            filledSymbols: [...filledSyms],
            legVenues: { ...legVenues },
          });
        }
        if (sold.length === 0) {
          setProgress(null);
          throw new Error(
            failed.length && failed[0].message
              ? `The sell didn't go through — ${failed[0].message} Nothing was sold.`
              : "The sell didn't go through. Nothing was sold.",
          );
        }
        setSuccess({ totalUsd: proceeds, sold, failed, anySettling: sold.some((s) => s.settling) });
        setPhase("done");
        setProgress(null);
        refreshBalances();

        // RFQ proceeds unwrap into USDG minutes later — watch each settling fill
        // and refetch balances the moment it lands, instead of waiting for the
        // passive 30s poll to notice the cash.
        for (const s of sold) {
          if (!s.settling || !s.txHash) continue;
          void waitForRfqFill(s.txHash, { timeoutMs: 15 * 60_000 })
            .then((st) => {
              if (st.filled) refreshBalances();
            })
            .catch(() => {});
        }
      } catch (e) {
        setError(explainError(e));
        setPhase("error");
        setProgress(null);
      }
    },
    [activeWallet, demo, refreshBalances, signTypedData],
  );

  return { phase, error, success, progress, sellAll, stop, reset, busy: phase === "selling" };
}
