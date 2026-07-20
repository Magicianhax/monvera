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
import { useCallback, useState } from "react";
import { useSignTypedData } from "@privy-io/react-auth";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useRefreshBalances } from "@/hooks/useBalances";
import { useDemo } from "@/components/demo/DemoProvider";
import { explainError } from "@/lib/explainError";
import { executeSwap } from "@/hooks/useSwap";
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
}

export interface SoldHolding {
  symbol: string;
  name: string;
  amountUsd: number;
  txHash?: `0x${string}`;
  /** RFQ fill still unwrapping — proceeds land shortly, not instantly. */
  settling: boolean;
}

export interface SellSuccess {
  totalUsd: number;
  sold: SoldHolding[];
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

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setSuccess(null);
    setProgress(null);
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
          });
          await sleep(700);
        }
        setSuccess({
          totalUsd,
          anySettling: true,
          sold: sels.map((x) => ({ symbol: x.asset.symbol, name: x.asset.name, amountUsd: x.estUsd, txHash: DEMO_TX, settling: true })),
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
        const filledSyms: string[] = [];
        const total = sels.length;
        const startedAt = Date.now();
        let proceeds = 0;
        for (let idx = 0; idx < sels.length; idx++) {
          const sel = sels[idx];
          setProgress({
            total,
            done: idx,
            currentSymbol: sel.asset.symbol,
            proceedsUsd: proceeds,
            totalUsd,
            etaSeconds: idx === 0 ? total * 6 : Math.ceil(((Date.now() - startedAt) / 1000 / idx) * (total - idx)),
            mode,
            filledSymbols: [...filledSyms],
          });
          try {
            const trade = { side: "sell" as const, symbol: sel.asset.symbol, sellAmount: sel.amountIn };
            let res: { txHash: `0x${string}`; settling: boolean };
            try {
              res = await executeSwap(wallet, trade, signTyped);
            } catch (firstErr) {
              // A maker can pull between quote and settle — executeSwap re-quotes
              // internally, so one retry recovers most transient failures.
              console.warn(`[sell-all] ${sel.asset.symbol} retrying:`, firstErr instanceof Error ? firstErr.message : firstErr);
              res = await executeSwap(wallet, trade, signTyped);
            }
            sold.push({ symbol: sel.asset.symbol, name: sel.asset.name, amountUsd: sel.estUsd, txHash: res.txHash, settling: res.settling });
            filledSyms.push(sel.asset.symbol);
            proceeds += sel.estUsd;
          } catch (legErr) {
            console.error(`[sell-all] ${sel.asset.symbol} failed (after retry):`, legErr instanceof Error ? legErr.message : legErr);
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
          });
        }
        if (sold.length === 0) {
          setProgress(null);
          throw new Error("The sell didn't go through. Nothing was sold.");
        }
        setSuccess({ totalUsd: proceeds, sold, anySettling: sold.some((s) => s.settling) });
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

  return { phase, error, success, progress, sellAll, reset, busy: phase === "selling" };
}
