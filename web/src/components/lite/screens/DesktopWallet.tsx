"use client";

// Desktop Wallet — Monvera Desktop design. Total balance + Cash/Invested, the
// Invest/Receive/Send actions, the activity ledger, plus a $MONVERA card and a
// self-custody card in the rail. Same hooks as the mobile WalletScreen; Receive
// opens the shared BottomSheet (renders centered on desktop).
import { useState } from "react";
import { useUsdcBalance, usePortfolio, useRefreshBalances, type Holding } from "@/hooks/useBalances";
import { useTransactions } from "@/hooks/useTransactions";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { QRCodeSVG } from "qrcode.react";
import { CountUp, BottomSheet, useToast } from "@/components/design";
import { ActivityGlyph } from "@/components/lite/ActivityGlyph";
import { usd, tokenQty, shortAddress, relTime, fmtAmt } from "@/lib/format";
import { toWalletEvents, eventLabel } from "@/lib/walletActivity";
import { DIcon, Panel, ViewAll } from "./deskKit";

type Go = (target: string | number, params?: Record<string, unknown>) => void;

export function DesktopWallet({ go }: { go: Go }) {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const { data: txs } = useTransactions(address ?? undefined);
  const refresh = useRefreshBalances();
  const { notify } = useToast();
  const [recvOpen, setRecvOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const cash = bal?.value ?? 0;
  const invested = port?.investedUsd ?? 0;
  const total = cash + invested;
  const monvera = (port?.holdings ?? []).find((h: Holding) => h.asset.symbol === "MONVERA");
  const events = toWalletEvents(txs ?? []).slice(0, 12);

  const copyAddress = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(true); notify("Address copied", "info"); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
  };

  const actionBtn = (primary?: boolean): React.CSSProperties => ({
    flex: "1 1 140px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 50,
    borderRadius: "var(--rr,22px)", fontSize: 15, fontWeight: 600,
    color: primary ? "var(--primary-ink)" : "var(--ink)", background: primary ? "var(--hero-grad)" : "var(--surface-2)",
    border: primary ? "none" : "1px solid var(--line)", boxShadow: primary ? "var(--shadow)" : "none",
  });

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px 60px" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div><div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 }}>Your money</div><h1 className="serif" style={{ margin: 0, fontSize: 27 }}>Wallet</h1></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => refresh()} className="desk-chip" aria-label="Refresh" style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink-2)" }}><DIcon name="clock" size={19} /></button>
            <button onClick={() => go("goal")} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, padding: "0 18px" }}><DIcon name="sparkle" size={17} /> Invest</button>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 22, marginTop: 24, alignItems: "start" }} className="desk-two-col">
          {/* main */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            <Panel style={{ padding: "22px 24px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-3)" }}>Total balance</span>
              <div className="tnum" style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1, marginTop: 4 }}><CountUp to={total} /></div>
              <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                {[{ l: "Cash · USDG", v: usd(cash) }, { l: "Invested", v: usd(invested) }].map((s) => (
                  <div key={s.l} style={{ flex: "1 1 130px", background: "var(--surface-2)", borderRadius: "var(--r-sm,12px)", padding: "12px 15px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--ink-3)" }}>{s.l}</div>
                    <div className="tnum" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{s.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
                <button onClick={() => go("goal")} style={actionBtn(true)}><DIcon name="sparkle" size={17} /> Invest</button>
                <button onClick={() => setRecvOpen(true)} className="desk-chip" style={actionBtn()}><DIcon name="down" size={17} /> Receive</button>
                <button onClick={() => go("send", { symbol: "USDG" })} className="desk-chip" style={actionBtn()}><DIcon name="send" size={17} /> Send</button>
              </div>
            </Panel>

            <Panel>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 12px", borderBottom: "1px solid var(--line-2)" }}>
                <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Activity</h2>
                {events.length > 0 && <ViewAll onClick={() => go("activity")} />}
              </div>
              {events.length === 0 ? (
                <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>No activity yet.</div>
              ) : (
                <div style={{ padding: "8px 10px 10px" }}>
                  {events.map((e, i) => {
                    const { verb, positive } = eventLabel(e);
                    const isTrade = e.kind === "buy" || e.kind === "sell";
                    const right = isTrade ? `${e.kind === "buy" ? "−" : "+"}${usd(e.usdgAmount ?? 0)}` : `${positive ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
                    return (
                      <div key={`${e.hash}-${i}`} className="desk-row" onClick={() => go("receipt", { kind: e.kind, symbol: e.symbol, assetAmount: e.amount, usdgAmount: e.usdgAmount, counterparty: e.counterparty, txHash: e.hash, ts: e.timestamp })} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10 }}>
                        <ActivityGlyph event={e} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>{verb} {e.symbol}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{isTrade ? "Swap" : "Transfer"}{e.timestamp ? " · " + relTime(e.timestamp) : ""}</div>
                        </div>
                        <span className="tnum" style={{ fontWeight: 600, fontSize: 14.5, color: (isTrade ? e.kind === "sell" : positive) ? "var(--pos)" : "var(--ink)" }}>{right}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* rail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {monvera && (
              <Panel style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 17, height: 17, WebkitMask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", mask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", background: "var(--primary)" }} />$MONVERA
                  </span>
                  {monvera.dayChangePct !== undefined && <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: monvera.dayChangePct >= 0 ? "var(--pos)" : "var(--neg)" }}>{(monvera.dayChangePct >= 0 ? "▲" : "▼") + Math.abs(monvera.dayChangePct).toFixed(1) + "%"}</span>}
                </div>
                <div className="tnum" style={{ fontSize: 24, fontWeight: 600, marginTop: 6 }}>{monvera.valueUsd !== undefined ? usd(monvera.valueUsd) : tokenQty(monvera.raw, 18)}</div>
                <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{tokenQty(monvera.raw, 18)} MONVERA</div>
                <button onClick={() => go("token")} className="desk-chip" style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", height: 44, marginTop: 12, borderRadius: "var(--rr,22px)", fontSize: 14, fontWeight: 600, color: "var(--ink)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>Trade $MONVERA</button>
              </Panel>
            )}

            <Panel style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--primary-soft)", display: "grid", placeItems: "center", color: "var(--primary)" }}><DIcon name="shield" size={17} /></span>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>Self-custody</span>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>Only you hold the keys. Monvera can never move your money — and every trade is gasless.</p>
              <button onClick={copyAddress} className="desk-chip" style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--r,16px)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{address ? shortAddress(address) : "…"}</span>
                <span style={{ color: copied ? "var(--pos)" : "var(--ink-3)", fontSize: 12, fontWeight: 600 }}>{copied ? "Copied" : "Copy"}</span>
              </button>
            </Panel>
          </div>
        </div>

        <BottomSheet open={recvOpen} onClose={() => setRecvOpen(false)} title="Receive">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "8px 4px 12px" }}>
            <div style={{ background: "#fff", padding: 14, borderRadius: 16 }}>{address ? <QRCodeSVG value={address} size={172} /> : <div className="skeleton" style={{ width: 172, height: 172 }} />}</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Your wallet address</div>
              <div className="mono" style={{ fontSize: 13.5, marginTop: 4 }}>{address ? shortAddress(address) : "…"}</div>
            </div>
            <button onClick={copyAddress} className="btn btn-outline" style={{ display: "flex", gap: 8 }}><DIcon name="wallet" size={17} /> Copy address</button>
          </div>
        </BottomSheet>
      </div>
    </div>
  );
}
