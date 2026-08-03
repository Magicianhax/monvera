"use client";

// Home menu — the "Monvera Chat" design's home surface: total balance + chart,
// $MONVERA card, Scan banner, menu tiles, and Movers / Your holdings / Losers.
// Styles are ported near-verbatim from the design (monvera-chat-desktop.html);
// data is real: /api/portfolio, /api/token-price, /api/market, /api/prices.
// Glass panels MUST keep style={{ background: "var(--panel)", ... }} — the
// theme's inset-highlight selector keys off that exact serialized string.
import { useMemo } from "react";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { holdingWorth, usePortfolio, useBalanceHistory } from "@/hooks/useBalances";
import { useMonveraPrice, useMonveraChart } from "@/hooks/useMonveraToken";
import { useMarketSummary } from "@/hooks/useMarket";
import { usePrices } from "@/hooks/usePrices";
import { STOCKS } from "@/lib/tokens";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { PIcon, ChatMark, ChartHover, SkeletonBar, usd, pctStr, priceStr, dcol, chartPaths, curve, type ChatNav } from "./chatKit";
import { portfolioDayCurve, equityCurveFrom } from "@/lib/portfolioCurve";
import { useHidden, setHidden, money } from "./privacy";

// The token chart falls back to a synthetic shape while history loads. The
// BALANCE chart never does: it draws the real intraday value of what the user
// actually holds (portfolioDayCurve), or nothing at all. Drawing an invented
// wave under someone's real balance reads as their money moving — it isn't.
const TOKEN_CHART_FALLBACK = chartPaths(curve(0.35, 44, 0.2, 1.8), 640, 110);

// The design's menuTiles (script L710-717), wired to the real nav.
const MENU_TILES: { label: string; sub: string; icon: string; go: (nav: ChatNav) => void }[] = [
  { label: "Invest with Vera", sub: "Goal → plan → done", icon: "ph-sparkle", go: (n) => n.goChat() },
  // Groves are full pages INSIDE the app — a center takeover, not a canvas.
  { label: "Groves", sub: "Curated stock baskets", icon: "ph-tree", go: (n) => n.openGroves() },
  { label: "Autopilot", sub: "Invest on repeat", icon: "ph-sliders-horizontal", go: (n) => n.openCanvas("autopilot") },
  { label: "Trade it yourself", sub: "Buy & sell any asset", icon: "ph-hand-tap", go: (n) => n.openCanvas("market") },
  { label: "Portfolio & Wallet", sub: "Holdings, cash & activity", icon: "ph-chart-pie-slice", go: (n) => n.openCanvas("portfolio") },
  { label: "Market", sub: "Browse prices & trends", icon: "ph-squares-four", go: (n) => n.openCanvas("market") },
  { label: "Insights", sub: "What Vera notices", icon: "ph-lightbulb", go: (n) => n.openCanvas("insights") },
];

/** $4.28M-style compact money for the token stat tiles. */
function usdCompact(n?: number): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3).toLocaleString("en-US") + "K";
  return usd(n);
}

const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--ink-3)" };
const tileLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" };

// Naked stat pair — no box-inside-box; the tiny caps label carries the structure.
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "6px 2px" }}>
      <div style={tileLabel}>{label}</div>
      <div className="tnum" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 1 }}>{value}</div>
    </div>
  );
}

interface MarketRow { symbol: string; name: string; day: number; }

/** Movers / Losers — a naked list straight on the aurora (no box). */
function MarketPanel({ title, rows, priceOf, nav }: { title: string; rows: MarketRow[]; priceOf: (sym: string) => number | undefined; nav: ChatNav }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: "4px 2px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-2)", padding: "8px 8px 6px" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "flex-start" }}>
        {rows.map((m) => {
          const p = priceOf(m.symbol);
          return (
            <button key={m.symbol} className="hgl" onClick={() => nav.openCanvas("holding", m.symbol)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, borderRadius: 12, textAlign: "left" }}>
              <AssetTile asset={toTile(m.symbol, m.name)} size={30} radius={9} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 13.5 }}>{m.symbol}</span>
                <span className="tnum" style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{p != null ? priceStr(p) : "—"}</span>
              </span>
              <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: dcol(m.day) }}>{pctStr(m.day)}</span>
            </button>
          );
        })}
        {rows.length === 0 && <div style={{ padding: 8, fontSize: 12, color: "var(--ink-3)" }}>Loading market…</div>}
      </div>
    </div>
  );
}

export function HomeMenu({ nav }: { nav: ChatNav }) {
  const hidden = useHidden();
  const { address } = useSmartAccount();
  const { data: pf, isPending } = usePortfolio(address ?? undefined);
  const { data: snaps } = useBalanceHistory(address ?? undefined);
  const { data: token } = useMonveraPrice();
  const { data: tokenHistory } = useMonveraChart("1d");
  const { data: market } = useMarketSummary();
  const { data: prices } = usePrices();

  // Real holdings, MONVERA excluded (it renders in its own card), sorted by
  // full worth so Grove-held and settling shares count too.
  const holdings = useMemo(
    () =>
      (pf?.holdings ?? [])
        .filter((h) => h.asset.symbol !== "MONVERA" && holdingWorth(h) > 0)
        .slice()
        .sort((a, b) => holdingWorth(b) - holdingWorth(a)),
    [pf],
  );
  const monvera = pf?.holdings.find((h) => h.asset.symbol === "MONVERA");
  const heldSum = holdings.reduce((s, h) => s + holdingWorth(h), 0);
  const dayUsd = holdings.reduce((s, h) => s + (holdingWorth(h) * (h.dayChangePct ?? 0)) / 100, 0);
  const total = pf?.totalUsd ?? 0;
  const dayPct = total - dayUsd > 0 ? (dayUsd / (total - dayUsd)) * 100 : 0;
  const dayStr = (dayUsd >= 0 ? "+" : "-") + usd(Math.abs(dayUsd)) + " (" + pctStr(dayPct) + ")";

  // Top 5 gainers / top 4 losers across the real stock universe (1D moves).
  const { movers, losers } = useMemo(() => {
    const summary = market?.summary;
    if (!summary) return { movers: [] as MarketRow[], losers: [] as MarketRow[] };
    const rows: MarketRow[] = [];
    for (const s of STOCKS) {
      const day = summary[s.symbol]?.dayChangePct;
      if (typeof day === "number") rows.push({ symbol: s.symbol, name: s.name, day });
    }
    return {
      movers: rows.filter((r) => r.day > 0).sort((a, b) => b.day - a.day).slice(0, 5),
      losers: rows.filter((r) => r.day < 0).sort((a, b) => a.day - b.day).slice(0, 4),
    };
  }, [market]);
  const priceOf = (sym: string) => prices?.prices[sym]?.priceUsd;

  const tokenPaths = useMemo(
    () => (tokenHistory?.series && tokenHistory.series.length > 1 ? chartPaths(tokenHistory.series, 640, 110) : TOKEN_CHART_FALLBACK),
    [tokenHistory],
  );
  const tokenQty = monvera?.qty ?? 0;
  const tokenChangeStr = token ? (token.change24h >= 0 ? "▲" : "▼") + Math.abs(token.change24h).toFixed(1) + "% · 24h" : "— · 24h";

  return (
    <main className="scr" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "26px 28px 48px" }}>
        {/* ── header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 500 }}>Good to see you 👋</div>
            <h1 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 500 }}>Your money</h1>
          </div>
          <button onClick={nav.goChat} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, color: "var(--primary-ink)", background: "var(--primary)" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%,#fff,transparent 40%),conic-gradient(from 200deg,rgba(255,255,255,.9),rgba(255,255,255,.5),rgba(255,255,255,.9))" }} /> Ask Vera
          </button>
        </div>

        {/* ── balance + $MONVERA ── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 18, marginBottom: 18 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 22, padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>Total balance</div>
              <button onClick={() => setHidden(!hidden)} aria-label={hidden ? "Show balances" : "Hide balances"} title={hidden ? "Show balances" : "Hide balances"} style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-3)" }}>
                <PIcon name={hidden ? "ph-eye-slash" : "ph-eye"} size={14} weight="bold" />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 2 }}>
              {/* Never $0.00 while loading — the first frame of a funded account
                  must not read as "my funds are gone". */}
              {isPending ? (
                <SkeletonBar w={170} h={34} style={{ margin: "3px 0" }} />
              ) : (
                <>
                  <span className="serif tnum" style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-.02em", lineHeight: 1 }}>{money(total, hidden)}</span>
                  <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: dcol(dayUsd) }}>{dayStr} today</span>
                </>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              {(() => {
                if (isPending) {
                  return <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center" }}><SkeletonBar w="100%" h={96} /></div>;
                }
                // Real equity curve (hourly snapshots incl. deposits/trades)
                // once enough history exists; intraday holdings curve until then.
                const day =
                  equityCurveFrom(snaps ?? [], pf?.totalUsd) ??
                  portfolioDayCurve(pf?.holdings ?? [], (pf?.cashUsd ?? 0) + (pf?.smartCashUsd ?? 0));
                if (!day) {
                  return (
                    <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center", borderTop: "1px dashed var(--line-2)", fontSize: 12.5, color: "var(--ink-3)" }}>
                      {(pf?.holdings ?? []).length ? "Not enough price movement today to chart yet." : "Your balance chart appears once you own something."}
                    </div>
                  );
                }
                const paths = chartPaths(day.curve, 640, 130, { minSpanFrac: 0.02 });
                return (
                  <ChartHover series={day.curve} vh={130} fmt={(v) => usd(v)}>
                    <svg viewBox="0 0 640 130" preserveAspectRatio="none" width="100%" height="130" style={{ display: "block" }}>
                      <defs>
                        <linearGradient id="mvcHome" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={paths.area} fill="url(#mvcHome)" />
                      <path d={paths.line} fill="none" stroke="var(--primary)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </ChartHover>
                );
              })()}
            </div>
            <div style={{ display: "flex", marginTop: 6, paddingTop: 16, borderTop: "1px solid var(--line-2)" }}>
              <div style={{ flex: 1 }}>
                <div style={statLabel}>Cash</div>
                {/* ALL cash — EOA plus grove-exit USDG — so Cash + Invested
                    matches the Total above instead of silently missing money. */}
                <div className="tnum" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{isPending ? <SkeletonBar w={72} h={18} /> : money((pf?.cashUsd ?? 0) + (pf?.smartCashUsd ?? 0), hidden)}</div>
                {!isPending && (pf?.smartCashUsd ?? 0) >= 0.01 && (
                  <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>incl. {money(pf?.smartCashUsd ?? 0, hidden)} from Grove exits</div>
                )}
              </div>
              <div style={{ flex: 1, paddingLeft: 16, borderLeft: "1px solid var(--line-2)" }}>
                <div style={statLabel}>Invested</div>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{isPending ? <SkeletonBar w={72} h={18} /> : money(pf?.investedUsd ?? 0, hidden)}</div>
              </div>
              <div style={{ flex: 1, paddingLeft: 16, borderLeft: "1px solid var(--line-2)" }}>
                <div style={statLabel}>Holdings</div>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{isPending ? <SkeletonBar w={30} h={18} /> : holdings.length}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={nav.openSend} style={{ flex: 1, height: 42, border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink)", fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <PIcon name="ph-paper-plane-tilt" size={16} style={{ color: "var(--primary)" }} /> Send
              </button>
              <button onClick={nav.openReceive} style={{ flex: 1, height: 42, border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink)", fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <PIcon name="ph-qr-code" size={16} style={{ color: "var(--primary)" }} /> Receive
              </button>
            </div>
          </div>

          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, padding: "16px 18px", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}><ChatMark size={15} />$MONVERA</span>
              <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: token ? dcol(token.change24h) : "var(--ink-3)" }}>{tokenChangeStr}</span>
            </div>
            <div className="serif tnum" style={{ fontSize: 26, fontWeight: 500, marginTop: 4 }}>{token?.priceUsd != null ? priceStr(token.priceUsd) : "—"}</div>
            <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
              You hold {hidden ? "•••" : tokenQty.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              {(monvera?.stakedQty ?? 0) > 0 ? <> · {hidden ? "•••" : Math.round(monvera!.stakedQty!).toLocaleString("en-US")} staked</> : null}
              {" · ≈ "}{money(monvera ? holdingWorth(monvera) : 0, hidden)}
            </div>
            <div style={{ flex: 1, minHeight: 56, marginTop: 10, display: "flex" }}>
              {/* hover readout only on real history, never the fallback curve */}
              <ChartHover series={tokenHistory?.series && tokenHistory.series.length > 1 ? tokenHistory.series : null} vh={110} fmt={priceStr} color="var(--pos)">
                <svg viewBox="0 0 640 110" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: "auto" }}>
                  <defs>
                    <linearGradient id="mvcTokHome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--pos)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--pos)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={tokenPaths.area} fill="url(#mvcTokHome)" />
                  <path d={tokenPaths.line} fill="none" stroke="var(--pos)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </ChartHover>
            </div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <StatTile label="Mkt cap" value={usdCompact(token?.marketCap)} />
              <StatTile label="24h volume" value={usdCompact(token?.volume24h)} />
              <StatTile label="Liquidity" value={usdCompact(token?.liquidityUsd)} />
              <StatTile label="Supply" value="1B" />
            </div>
            {/* prominent tinted glass (buy) + plain glass (sell) — the iOS 26 pair */}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => nav.openBuy("MONVERA")} style={{ flex: 1, height: 38, borderRadius: 11, fontSize: 13, fontWeight: 700, background: "linear-gradient(180deg,var(--primary-2),var(--primary))", border: "1px solid color-mix(in srgb,var(--primary) 70%,#000 8%)", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.25)" }}>Buy</button>
              <button onClick={() => nav.openSell("MONVERA")} style={{ flex: 1, height: 38, borderRadius: 11, fontSize: 13, fontWeight: 600, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)" }}>Sell</button>
            </div>
          </div>
        </div>

        {/* ── scan banner + tiles | movers · holdings · losers ── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            <button onClick={() => nav.openCanvas("scan")} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", border: "1px solid var(--line)", borderRadius: 18, background: "linear-gradient(120deg,color-mix(in srgb,var(--primary) 13%,transparent),transparent 70%),var(--panel)", textAlign: "left" }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}><PIcon name="ph-camera" size={18} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>Scan to Buy</span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-2)" }}>Photograph any product — Vera invests in the companies behind it</span>
              </span>
              {tokenQty >= 100_000
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--primary)", flex: "none" }}><PIcon name="ph-check-circle" size={13} weight="fill" /> Unlocked</span>
                : <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--ink-3)", flex: "none" }}><PIcon name="ph-lock" size={13} /> 100k $MONVERA</span>}
            </button>
            {/* naked launchers — the icon chip is the anchor, no card box */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 4 }}>
              {MENU_TILES.map((t) => (
                <button key={t.label} className="hgl" onClick={() => t.go(nav)} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, padding: "13px 12px", borderRadius: 16, background: "transparent", textAlign: "left" }}>
                  <span style={{ width: 44, height: 44, borderRadius: 13, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}><PIcon name={t.icon} size={20} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{t.label}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <MarketPanel title="Movers" rows={movers} priceOf={priceOf} nav={nav} />

          {/* naked holdings list — no box, hairline rows on the aurora */}
          <div style={{ minWidth: 0, padding: "4px 2px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 8px 6px" }}>
              <h2 style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-2)" }}>Your holdings</h2>
              <button onClick={() => nav.openCanvas("portfolio")} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)" }}>View all</button>
            </div>
            <div>
              {holdings.map((h) => {
                const sym = h.asset.symbol;
                const worthUsd = holdingWorth(h);
                const inGrove = (h.smartUsd ?? 0) > 0;
                return (
                  <button key={sym} className="hgl" onClick={() => nav.openCanvas("holding", sym)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 8px", textAlign: "left", borderRadius: 12 }}>
                    <AssetTile asset={toTile(sym, h.asset.name)} size={32} radius={9} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.asset.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{heldSum > 0 ? Math.round((worthUsd / heldSum) * 100) + "% of portfolio" : ""}{inGrove ? " · in a Grove" : ""}</span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className="tnum" style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{usd(worthUsd)}</span>
                      <span className="tnum" style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: dcol(h.dayChangePct ?? 0) }}>{h.dayChangePct != null ? pctStr(h.dayChangePct) : "—"}</span>
                    </span>
                  </button>
                );
              })}
              {holdings.length === 0 && (
                <div style={{ padding: "10px 8px", fontSize: 12.5, color: "var(--ink-2)" }}>
                  {isPending ? <SkeletonBar w="70%" h={13} /> : "Nothing yet — ask Vera to put your cash to work."}
                </div>
              )}
            </div>
          </div>

          <MarketPanel title="Losers" rows={losers} priceOf={priceOf} nav={nav} />
        </div>
      </div>
    </main>
  );
}
