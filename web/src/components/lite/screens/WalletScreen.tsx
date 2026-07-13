"use client";

// Wallet — the account's money in one place: total balance, quick Send / Receive
// / Invest, spendable cash (USDG), holdings (live price · qty · value), and the
// full incoming/outgoing transaction history. Receive is an in-place sheet (QR +
// address); each transaction opens a detail sheet with a Blockscout link.
//
// Ledger layout: edge-to-edge hairline sections (no card stacks), centered
// balance hero, flat action strip, 22px gutters.
import { useEffect, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useUsdcBalance, usePortfolio, useRefreshBalances, type Holding } from "@/hooks/useBalances";
import { useTransactions } from "@/hooks/useTransactions";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useLegacyRecover } from "@/hooks/useLegacyRecover";
import { Icon, type IconName, HoldingRow, CountUp, BottomSheet, useToast } from "@/components/design";
import { SelfCustodyProof } from "@/components/shared/SelfCustodyProof";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { ActivityGlyph } from "@/components/lite/ActivityGlyph";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, tokenQty, shortAddress, txUrl, relTime, fmtAmt } from "@/lib/format";
import { toWalletEvents, eventLabel } from "@/lib/walletActivity";
import { haptic } from "@/lib/haptics";
import { iconBtn, Pager, boxHead, innerBox } from "./primitives";

const DOTS = "••••••";
const HAIRLINE = "1px solid var(--line)";
const HAIRLINE_2 = "1px solid var(--line-2)";

// Ledger section header — strong sans in the 22px gutter.
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "28px 22px 10px", fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
      {children}
    </div>
  );
}

// One target in the flat action strip — icon + label, equal width, flat.
function ActionBtn({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="tap"
      style={{
        flex: 1,
        padding: "14px 8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        background: "color-mix(in srgb, var(--primary) 12%, var(--glass-bg))",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderRadius: "var(--rr)",
        boxShadow: "var(--shadow)",
      }}
    >
      <Icon name={icon} size={20} style={{ color: "var(--primary)" }} />
      <span style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: "-.01em" }}>{label}</span>
    </button>
  );
}

export function WalletScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address, loading: addrLoading } = useSmartAccount();
  const { data: bal, isLoading: balLoading } = useUsdcBalance(address ?? undefined);
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);
  const { data: txs, isLoading: txLoading } = useTransactions(address ?? undefined);
  const { notify } = useToast();
  const recover = useLegacyRecover();
  const refreshBalances = useRefreshBalances();
  useEffect(() => {
    if (recover.phase === "done") {
      notify("Moved to your account", "check");
      refreshBalances();
    }
  }, [recover.phase, notify, refreshBalances]);
  const [hide, setHide] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [txPage, setTxPage] = useState(0);

  const cash = bal?.value ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  const total = cash + invested;

  // Activity: raw transfers grouped into Buy/Sell/Send/Receive events, 10/page.
  const events = toWalletEvents(txs ?? []);
  const txPageCount = Math.max(1, Math.ceil(events.length / 10));
  const txSafePage = Math.min(txPage, txPageCount - 1);
  const evtRows = events.slice(txSafePage * 10, txSafePage * 10 + 10);

  // Before the wallet resolves, the balance queries are disabled (not
  // isLoading) — treat that phase as loading too, so we never show a $0.00
  // fallback dressed as real.
  const walletPending = addrLoading || !address;
  const loading = walletPending || balLoading || portLoading;
  const balLen = usd(total).length;
  const balSize = balLen <= 9 ? 44 : balLen <= 11 ? 38 : 32;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      haptic.light();
      notify("Address copied", "check");
    } catch {
      /* clipboard may be unavailable; the QR + visible address still work */
    }
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 48 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>Wallet</h1>
        <button
          onClick={() => setHide((v) => !v)}
          className="tap"
          aria-label={hide ? "Show balances" : "Hide balances"}
          style={{ ...iconBtn, marginLeft: "auto", color: hide ? "var(--primary)" : "var(--ink-2)" }}
        >
          <Icon name="eye" size={19} stroke={hide ? 2.4 : 1.8} />
        </button>
      </div>

      {/* recover USDG stranded in the previous (smart-account) address — a
          genuine standalone notice, so it keeps its card. */}
      {recover.hasFunds && (
        <div style={{ padding: "14px 22px 0" }}>
          <div className="card" style={{ padding: "15px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Icon name="info" size={17} stroke={2} style={{ color: "var(--accent)", flex: "none" }} />
              <span style={{ fontSize: 14.5, fontWeight: 500 }}>Recover previous balance</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              You have <b className="tnum" style={{ color: "var(--ink)" }}>{usd(recover.usdValue)}</b> in your previous account
              address. Move it to your current account, gas-free.
            </div>
            {recover.error && <div style={{ fontSize: 12.5, color: "var(--neg)" }}>{recover.error}</div>}
            <button
              className="btn btn-primary btn-block tap"
              disabled={recover.phase === "moving"}
              onClick={() => recover.recover()}
              style={{ height: 46 }}
            >
              {recover.phase === "moving" ? "Moving…" : `Move ${usd(recover.usdValue)} here`}
            </button>
          </div>
        </div>
      )}

      {/* balance block — centered hero, flat */}
      <div className="anim-rise" style={{ padding: "22px 22px 0", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-2)" }}>Total balance</div>
        <div style={{ marginTop: 6, minHeight: 46 }}>
          {loading ? (
            <div className="skeleton" style={{ width: 180, height: 40, borderRadius: 6, margin: "4px auto 0" }} />
          ) : (
            <div className="tnum" style={{ fontSize: balSize, fontWeight: 600, letterSpacing: "-.045em", lineHeight: 1 }}>
              {hide ? <span style={{ letterSpacing: ".06em" }}>{DOTS}</span> : <CountUp to={total} />}
            </div>
          )}
        </div>
        {loading ? (
          <div className="skeleton" style={{ width: 198, height: 13, borderRadius: 4, margin: "10px auto 0" }} />
        ) : (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-2)" }}>
            Cash <b className="tnum" style={{ color: "var(--ink)" }}>{hide ? DOTS : usd(cash)}</b>
            <span aria-hidden style={{ margin: "0 7px", color: "var(--ink-3)" }}>·</span>
            Invested <b className="tnum" style={{ color: "var(--ink)" }}>{hide ? DOTS : usd(invested)}</b>
          </div>
        )}
      </div>

      {/* action strip — three soft tinted boxes (match Home quick actions) */}
      <div style={{ display: "flex", gap: 10, marginTop: 18, padding: "0 22px" }}>
        <ActionBtn icon="arrowUR" label="Send" onClick={() => go("send")} />
        <ActionBtn icon="arrowDR" label="Receive" onClick={() => { haptic.light(); setReceiveOpen(true); }} />
        <ActionBtn icon="plus" label="Invest" onClick={() => go("market")} />
        {holdings.length > 0 && <ActionBtn icon="trendDown" label="Sell" onClick={() => go("sellall")} />}
      </div>

      {/* cash */}
      <SectionHeader>Cash</SectionHeader>
      <button
        className="tap"
        onClick={() => go("send", { symbol: "USDG" })}
        style={{ width: "calc(100% - 44px)", margin: "4px 22px 0", padding: "14px 16px", display: "flex", alignItems: "center", gap: 13, textAlign: "left", background: "var(--surface)", borderRadius: "var(--rr)", boxShadow: "var(--shadow)" }}
      >
        <TokenLogo symbol="USDG" size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 15.5, letterSpacing: "-.01em" }}>US Dollar</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>USDG · spendable cash</div>
        </div>
        {walletPending || (balLoading && !bal) ? (
          <div className="skeleton" style={{ width: 64, height: 16, borderRadius: 4 }} aria-label="Loading cash balance" />
        ) : (
          <div className="tnum" style={{ fontWeight: 600, fontSize: 16 }}>{hide ? DOTS : usd(cash)}</div>
        )}
      </button>

      {/* holdings — one outer box, rows as mini boxes inside */}
      {holdings.length > 0 && !(walletPending || (portLoading && !port)) && (
        <section style={{ padding: "22px 22px 0" }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Holdings</div>
            <div className="stagger-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {holdings.map((h) => {
                const base = toTile(h.asset.symbol, h.asset.name);
                const tile = { ...base, day: h.dayChangePct ?? base.day, spark: h.spark ?? base.spark };
                const dec = h.asset.decimals ?? 18;
                return (
                  <div key={h.asset.symbol} style={{ padding: "2px 8px", background: "var(--glass-bg-2)", borderRadius: "var(--r-lg)" }}>
                    <HoldingRow
                      asset={tile}
                      sub={catFor(h.asset.symbol, h.asset.name)}
                      showSpark
                      onClick={() => go("asset", { symbol: h.asset.symbol })}
                      right={
                        <div style={{ textAlign: "right" }}>
                          <div className="tnum" style={{ fontWeight: 500, fontSize: 16 }}>
                            {hide ? DOTS : h.valueUsd !== undefined ? usd(h.valueUsd) : "—"}
                          </div>
                          <div className="tnum" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                            {hide ? DOTS : `${tokenQty(h.raw, dec)} ${h.asset.symbol}`}
                          </div>
                        </div>
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* activity — grouped Buy/Sell/Send/Receive, one outer box, mini boxes inside */}
      {(walletPending || (txLoading && !txs)) && events.length === 0 ? (
        <section style={{ padding: "22px 22px 0" }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Activity</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label="Loading activity">
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ ...innerBox }}>
                  <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 99, flex: "none" }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ width: 128, height: 13, borderRadius: 4 }} />
                    <div className="skeleton" style={{ width: 86, height: 10, borderRadius: 4, marginTop: 7 }} />
                  </div>
                  <div className="skeleton" style={{ width: 64, height: 13, borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : events.length === 0 ? (
        <section style={{ padding: "22px 22px 0" }}>
          <div className="card" style={{ padding: "24px 22px", textAlign: "center" }}>
            <div style={{ fontSize: 14.5, fontWeight: 500 }}>No activity yet</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>Your buys, sells, and transfers will show up here.</div>
          </div>
        </section>
      ) : (
        <section style={{ padding: "22px 22px 0" }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Activity</div>
            <div className="stagger-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {evtRows.map((e, i) => {
                const { verb, positive } = eventLabel(e);
                const isTrade = e.kind === "buy" || e.kind === "sell";
                const usdgLeg = `${e.kind === "buy" ? "−" : "+"}${usd(e.usdgAmount ?? 0)}`;
                const assetLeg = `${e.kind === "buy" ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
                const single = `${positive ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
                const sub = isTrade
                  ? (e.timestamp ? relTime(e.timestamp) : "Swap")
                  : `${shortAddress(e.counterparty)}${e.timestamp ? ` · ${relTime(e.timestamp)}` : ""}`;
                return (
                  <button
                    key={`${e.hash}-${txSafePage}-${i}`}
                    className="tap"
                    onClick={() =>
                      go("receipt", {
                        kind: e.kind,
                        symbol: e.symbol,
                        assetAmount: e.amount,
                        usdgAmount: e.usdgAmount,
                        counterparty: e.counterparty,
                        txHash: e.hash,
                        ts: e.timestamp,
                      })
                    }
                    style={{ ...innerBox }}
                  >
                    <ActivityGlyph event={e} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 15 }}>{verb} {e.symbol}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                    </div>
                    {isTrade ? (
                      <div className="tnum" style={{ textAlign: "right", flex: "none" }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: e.kind === "sell" ? "var(--pos)" : "var(--ink)" }}>{hide ? DOTS : usdgLeg}</div>
                        <div style={{ fontSize: 12, fontWeight: 500, marginTop: 1, color: e.kind === "buy" ? "var(--pos)" : "var(--ink-2)" }}>{hide ? DOTS : assetLeg}</div>
                      </div>
                    ) : (
                      <span className="tnum" style={{ fontWeight: 600, fontSize: 15, color: positive ? "var(--pos)" : "var(--ink)", flex: "none" }}>{hide ? DOTS : single}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
      {events.length > 10 && <Pager page={txSafePage} pageCount={txPageCount} onPage={setTxPage} />}

      {/* self-custody proof — the account is yours, the key is yours */}
      <section style={{ padding: "26px 22px 0" }}>
        <SelfCustodyProof />
      </section>

      {/* receive sheet */}
      <BottomSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "4px 4px 8px" }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.5 }}>
            Send <b style={{ color: "var(--ink)" }}>USDG on Robinhood Chain</b> to this address. It arrives in under a minute.
          </p>
          {addrLoading || !address ? (
            <div className="skeleton" style={{ width: 196, height: 196, borderRadius: 6 }} aria-label="Loading address" />
          ) : (
            <div style={{ padding: 14, background: "#fff", borderRadius: 6, border: HAIRLINE, lineHeight: 0 }}>
              <QRCodeSVG value={address} size={168} level="M" marginSize={0} bgColor="#ffffff" fgColor="#1c201a" />
            </div>
          )}
          <button onClick={copyAddress} disabled={!address} className="tap" aria-label="Copy address" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 14px", borderRadius: 5, background: "var(--surface-2)", border: HAIRLINE_2 }}>
            <span className="mono" style={{ fontSize: 14 }}>{address ? `${address.slice(0, 12)}…${address.slice(-8)}` : "…"}</span>
            <Icon name="link" size={17} style={{ color: "var(--ink-2)", flex: "none" }} />
          </button>
          <button onClick={copyAddress} disabled={!address} className="btn btn-primary btn-block tap" style={{ height: 50 }}>Copy address</button>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 5, background: "var(--accent-soft)", color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.5 }}>
            <Icon name="info" size={16} stroke={2} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
            <span>Only send <b style={{ color: "var(--ink)" }}>USDG</b> on <b style={{ color: "var(--ink)" }}>Robinhood Chain</b>. Other tokens or networks may be lost.</span>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
