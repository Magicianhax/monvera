"use client";

// Desktop Activity — the full wallet ledger as a single scrollable list. Same
// event source as the desktop Home/Wallet (useTransactions → toWalletEvents),
// styled to the Monvera Desktop design.
import { usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useTransactions } from "@/hooks/useTransactions";
import { toWalletEvents, eventLabel } from "@/lib/walletActivity";
import { ActivityGlyph } from "@/components/lite/ActivityGlyph";
import { usd, fmtAmt } from "@/lib/format";
import { Panel } from "./deskKit";

type Go = (screen: string, params?: Record<string, unknown>) => void;

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const d = Math.max(0, Date.now() / 1000 - ts);
  if (d < 3600) return Math.max(1, Math.round(d / 60)) + "m ago";
  if (d < 86400) return Math.round(d / 3600) + "h ago";
  return Math.round(d / 86400) + "d ago";
}

export function DesktopActivity({ go }: { go: Go }) {
  const { address } = useSmartAccount();
  const { data: txs, isLoading } = useTransactions(address ?? undefined);
  usePortfolio(address ?? undefined); // keep balances warm alongside the ledger
  const events = toWalletEvents(txs ?? []);

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 820, margin: "0 auto", padding: "28px 32px 60px" }}>
        <h1 className="serif" style={{ margin: "0 0 22px", fontSize: 27 }}>Activity</h1>
        <Panel style={{ padding: "8px 12px 12px" }}>
          {events.length === 0 ? (
            <div style={{ padding: "40px 12px", textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>
              {isLoading ? "Loading your activity…" : "No activity yet. Your trades and transfers will appear here."}
            </div>
          ) : (
            events.map((e, i) => {
              const { verb, positive } = eventLabel(e);
              const isTrade = e.kind === "buy" || e.kind === "sell";
              const right = isTrade ? `${e.kind === "buy" ? "−" : "+"}${usd(e.usdgAmount ?? 0)}` : `${positive ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
              return (
                <div
                  key={`${e.hash}-${i}`}
                  className="desk-row"
                  onClick={() => go("receipt", { kind: e.kind, symbol: e.symbol, assetAmount: e.amount, usdgAmount: e.usdgAmount, counterparty: e.counterparty, txHash: e.hash, ts: e.timestamp })}
                  style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 10px", borderBottom: i < events.length - 1 ? "1px solid var(--line-2)" : "none", borderRadius: 10 }}
                >
                  <ActivityGlyph event={e} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 15 }}>{verb} {e.symbol}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>{isTrade ? "Swap" : e.symbol}{e.timestamp ? " · " + timeAgo(e.timestamp) : ""}</div>
                  </div>
                  <span className="tnum" style={{ fontWeight: 600, fontSize: 15, color: (isTrade ? e.kind === "sell" : positive) ? "var(--pos)" : "var(--ink)" }}>{right}</span>
                </div>
              );
            })
          )}
        </Panel>
      </div>
    </div>
  );
}
