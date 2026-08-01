"use client";

// Desktop Home — the Monvera Desktop "Overview". Full-width two-column dashboard:
// balance + value chart + holdings table + movers on the left; Invest-with-Vera,
// allocation donut, $MONVERA, Scan and the trust row on the right. Same live data
// hooks as the mobile Home — only the composition is desktop-native.
import { useState } from "react";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useNotifications } from "@/hooks/useNotifications";
import { useMonveraPrice } from "@/hooks/useMonveraToken";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { VeraOrb, AssetTile, Sparkline } from "@/components/design";
import { toTile } from "@/lib/displayAssets";
import { STOCKS } from "@/lib/tokens";
import { usd, priceStr, pctStr, dcol, DIcon, Panel, AreaChart, curve, RANGE_DEFS, Donut, ViewAll } from "./deskKit";

type Go = (screen: string, params?: Record<string, unknown>) => void;
const DOTS = "••••••";
const RANGES = ["1D", "1W", "1M", "3M", "1Y", "All"];

export function DesktopHome({ go }: { go: Go }) {
  const unread = useNotifications().data?.unread ?? 0;
  const { data: tok } = useMonveraPrice();
  const { address } = useSmartAccount();
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);
  const { data: prices } = usePrices();
  const { data: market } = useMarketSummary();
  const [hide, setHide] = useState(false);
  const [range, setRange] = useState("1Y");

  const cash = port?.cashUsd ?? 0;
  const invested = port?.investedUsd ?? 0;
  const total = port?.totalUsd ?? 0;
  const holdings: Holding[] = (port?.holdings ?? []).filter((h) => h.asset.symbol !== "MONVERA").slice().sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const mon = (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA");

  const dayU = holdings.reduce((s, h) => s + (h.valueUsd ?? 0) * ((h.dayChangePct ?? 0) / 100), 0);
  const dayPct = total - dayU > 0 ? (dayU / (total - dayU)) * 100 : 0;
  const mask = (s: string) => (hide ? DOTS : s);

  // movers — top 5 by |day change| across the tradable universe
  const movers = STOCKS.map((a) => ({ sym: a.symbol, name: a.name, day: market?.summary[a.symbol]?.dayChangePct ?? 0, price: prices?.prices[a.symbol]?.priceUsd }))
    .filter((m) => m.price !== undefined && m.day !== 0)
    .sort((a, b) => Math.abs(b.day) - Math.abs(a.day))
    .slice(0, 5);

  // allocation donut — weights are the share of the *shown* (non-MONVERA)
  // holdings, so the ring sums to 100% (investedUsd also counts the MONVERA token).
  const stockValue = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  const donutSegs = holdings.filter((h) => (h.valueUsd ?? 0) > 0).map((h) => ({ name: toTile(h.asset.symbol, h.asset.name).name, wpct: stockValue > 0 ? ((h.valueUsd ?? 0) / stockValue) * 100 : 0 }));

  const rd = RANGE_DEFS[range] ?? RANGE_DEFS["1Y"];
  const valueSeries = curve(rd[0], rd[1], rd[2], rd[3]);

  const rd2 = (n: number) => (hide ? DOTS : n.toFixed(2) + "%");

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 1460, margin: "0 auto", padding: "20px 30px 48px" }}>
        {/* header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, height: 50 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <VeraOrb size={32} />
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>Good to see you 👋</div>
              <h1 className="serif" style={{ margin: 0, fontSize: 21, lineHeight: 1.15 }}>Overview</h1>
            </div>
          </div>
          <form style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 24px", minWidth: 0 }} onSubmit={(e) => { e.preventDefault(); go("market"); }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 480 }}>
              <span style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "grid" }}><DIcon name="search" size={18} /></span>
              <input placeholder="Search stocks, funds & markets…" onFocus={() => go("market")} style={{ height: 44, width: "100%", padding: "0 16px 0 42px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 14.5, fontFamily: "inherit", outline: "none", boxShadow: "var(--shadow)" }} />
            </div>
          </form>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
            {tok && (
              <button onClick={() => go("token")} className="tnum desk-chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)", fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
                <span style={{ width: 14, height: 14, WebkitMask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", mask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", background: "var(--primary)" }} />
                <span style={{ color: tok.change24h >= 0 ? "var(--pos)" : "var(--neg)" }}>{(tok.change24h >= 0 ? "▲" : "▼") + Math.abs(tok.change24h).toFixed(1) + "%"}</span>
              </button>
            )}
            <button onClick={() => go("wallet")} className="desk-chip" aria-label="Wallet" style={iconBtn}><DIcon name="wallet" size={18} /></button>
            <button onClick={() => go("notifications")} className="desk-chip" aria-label="Notifications" style={{ ...iconBtn, position: "relative" }}>
              <DIcon name="bell" size={18} />
              {unread > 0 && <span style={badge}>{unread > 9 ? "9+" : unread}</span>}
            </button>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 336px", gap: 20, marginTop: 20, alignItems: "start" }} className="desk-home-grid">
          {/* ── main column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {/* balance + chart */}
            <Panel style={{ padding: "20px 22px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "14px 16px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>Total balance</span>
                    <button onClick={() => setHide((v) => !v)} aria-label="Hide balance" style={{ width: 24, height: 24, display: "grid", placeItems: "center", color: hide ? "var(--primary)" : "var(--ink-3)" }}>
                      <DIcon name={hide ? "eyeOff" : "eye"} size={15} />
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 3 }}>
                    <span className="tnum" style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1 }}>
                      {portLoading ? <span className="skeleton" style={{ display: "inline-block", width: 200, height: 36, borderRadius: 6 }} /> : hide ? DOTS : usd(total)}
                    </span>
                    <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: dcol(dayU) }}>{(dayU >= 0 ? "+" : "−") + "$" + Math.abs(dayU).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "  (" + pctStr(dayPct) + ") today"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", maxWidth: "100%", background: "var(--surface-2)", borderRadius: 10, padding: 3, gap: 2 }}>
                  {RANGES.map((r) => (
                    <button key={r} onClick={() => setRange(r)} style={{ height: 28, padding: "0 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: range === r ? "var(--primary)" : "transparent", color: range === r ? "var(--primary-ink)" : "var(--ink-3)" }}>{r}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 16 }}><AreaChart series={valueSeries} up={dayU >= 0} height={150} uid={"home" + range} /></div>
              <div style={{ display: "flex", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line-2)" }}>
                {[
                  { label: "Cash available", value: mask(usd(cash)), color: "var(--ink)", pl: 0, bd: "transparent" },
                  { label: "Invested", value: mask(usd(invested)), color: "var(--ink)", pl: 18, bd: "var(--line-2)" },
                  { label: "Return today", value: rd2(dayPct), color: dcol(dayU), pl: 18, bd: "var(--line-2)" },
                ].map((st) => (
                  <div key={st.label} style={{ flex: 1, paddingLeft: st.pl, borderLeft: `1px solid ${st.bd}` }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--ink-3)" }}>{st.label}</div>
                    <div className="tnum" style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em", marginTop: 3, color: st.color }}>{st.value}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* holdings table */}
            <Panel>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 18px 11px", borderBottom: "1px solid var(--line-2)" }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Your holdings</h2>
                <ViewAll onClick={() => go("portfolio")} />
              </div>
              {holdings.length === 0 ? (
                <div style={{ padding: "34px 18px", textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>{portLoading ? "Loading your holdings…" : "No holdings yet — start a plan with Vera."}</div>
              ) : (
                <div style={{ padding: "6px 10px 8px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1.1fr 1fr 1fr 1fr", padding: "2px 12px 8px", borderBottom: "1px solid var(--line-2)", fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                    <span>Asset</span><span style={{ textAlign: "center" }}>7 days</span><span style={{ textAlign: "right" }}>Price</span><span style={{ textAlign: "right" }}>Day</span><span style={{ textAlign: "right" }}>Value</span>
                  </div>
                  {holdings.map((h) => {
                    const tile = toTile(h.asset.symbol, h.asset.name);
                    const day = h.dayChangePct ?? 0;
                    return (
                      <button key={h.asset.symbol} className="desk-row" onClick={() => go("asset", { symbol: h.asset.symbol })} style={{ display: "grid", gridTemplateColumns: "2.4fr 1.1fr 1fr 1fr 1fr", alignItems: "center", width: "100%", padding: "10px 12px", textAlign: "left", borderRadius: 9 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                          <AssetTile asset={tile} size={32} radius={9} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.name}</span>
                            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{h.asset.symbol}</span>
                          </span>
                        </span>
                        <span style={{ display: "flex", justifyContent: "center" }}><Sparkline data={h.spark ?? tile.spark} color={dcol(day)} /></span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>{h.priceUsd !== undefined ? priceStr(h.priceUsd) : "—"}</span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 13, fontWeight: 500, color: dcol(day) }}>{pctStr(day)}</span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 14, fontWeight: 600 }}>{hide ? DOTS : h.valueUsd !== undefined ? usd(h.valueUsd) : "—"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* movers */}
            {movers.length > 0 && (
              <Panel style={{ padding: "15px 18px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Today&apos;s movers</h2>
                  <ViewAll onClick={() => go("market")} label="Market" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
                  {movers.map((m) => {
                    const tile = toTile(m.sym, m.name);
                    return (
                      <button key={m.sym} className="desk-tile" onClick={() => go("asset", { symbol: m.sym })} style={{ textAlign: "left", border: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: "var(--r,16px)", padding: "11px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}><AssetTile asset={tile} size={24} radius={7} /><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{m.sym}</span></div>
                        <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{m.price !== undefined ? priceStr(m.price) : "—"}</div>
                        <div className="tnum" style={{ fontSize: 12, fontWeight: 600, color: dcol(m.day) }}>{pctStr(m.day)}</div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}
          </div>

          {/* ── right rail ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {/* Invest with Vera */}
            <Panel style={{ padding: 18, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 90% at 100% -10%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 60%)", pointerEvents: "none" }} />
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 13 }}>
                <VeraOrb size={44} pulse />
                <div><div style={{ fontSize: 15, fontWeight: 600 }}>Invest with Vera</div><div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.45 }}>Say a goal — she builds &amp; places the plan.</div></div>
              </div>
              <button onClick={() => go("goal")} className="btn btn-primary" style={{ position: "relative", display: "flex", width: "100%", justifyContent: "center", gap: 8, height: 44, marginTop: 14 }}><DIcon name="sparkle" size={16} /> Start a plan</button>
            </Panel>

            {/* Allocation donut */}
            <Panel style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Allocation</h2>
                <button onClick={() => go("portfolio")} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--primary)" }}>Details</button>
              </div>
              {donutSegs.length > 0 ? <Donut segs={donutSegs} count={donutSegs.length} /> : <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "10px 0" }}>No holdings to allocate yet.</div>}
            </Panel>

            {/* $MONVERA */}
            <Panel style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 16, height: 16, WebkitMask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", mask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", background: "var(--primary)" }} />$MONVERA
                </span>
                {tok && <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: tok.change24h >= 0 ? "var(--pos)" : "var(--neg)" }}>{(tok.change24h >= 0 ? "▲" : "▼") + Math.abs(tok.change24h).toFixed(1) + "%"}</span>}
              </div>
              <div className="tnum" style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.02em", marginTop: 6 }}>{tok ? priceStr(tok.priceUsd) : <span className="skeleton" style={{ display: "inline-block", width: 80, height: 22, borderRadius: 5 }} />}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
                <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>You hold</span>
                <span style={{ textAlign: "right" }}>
                  <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{mon ? Math.round(mon.qty).toLocaleString("en-US") + " MONVERA" : "0 MONVERA"}</span>
                  {mon?.valueUsd !== undefined && <span className="tnum" style={{ display: "block", fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>≈ {usd(mon.valueUsd)}</span>}
                </span>
              </div>
              <button onClick={() => go("token")} className="desk-chip" style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", height: 40, marginTop: 12, borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: "var(--ink)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>Trade $MONVERA</button>
            </Panel>

            {/* Scan to Buy */}
            <button onClick={() => go("scan")} className="desk-tile" style={{ textAlign: "left", background: "linear-gradient(120deg, color-mix(in srgb, var(--primary) 14%, var(--surface)), var(--surface) 70%)", border: "1px solid var(--line)", borderRadius: "var(--r-lg,22px)", boxShadow: "var(--shadow)", padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>Scan to Buy</span></div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5, lineHeight: 1.45 }}>Photograph any product — Vera invests in the companies behind it.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11, color: "var(--primary)", fontSize: 13, fontWeight: 600 }}><DIcon name="camera" size={16} /> Open Scan to Buy</div>
            </button>

            {/* trust row */}
            <button onClick={() => go("vera")} className="desk-tile" style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--line-2)", background: "none", color: "var(--ink)", padding: "10px 14px", borderRadius: "var(--r,16px)" }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--hero-grad)", display: "grid", placeItems: "center", flex: "none", color: "var(--primary-ink)", fontSize: 11, fontWeight: 700 }}>✓</span>
              <span style={{ flex: 1, textAlign: "left", fontSize: 12.5, fontWeight: 500 }}>Every plan signed &amp; recorded by Vera</span>
              <DIcon name="caretR" size={13} stroke={2.4} style={{ color: "var(--ink-3)" }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = { width: 36, height: 36, border: "1px solid var(--line)", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--surface)", color: "var(--ink-2)" };
const badge: React.CSSProperties = { position: "absolute", top: -4, right: -4, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 99, background: "var(--primary)", color: "var(--primary-ink)", fontSize: 9.5, fontWeight: 700, display: "grid", placeItems: "center", lineHeight: 1 };
