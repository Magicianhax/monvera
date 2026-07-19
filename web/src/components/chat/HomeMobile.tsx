"use client";

// Mobile home menu ("Monvera Chat Mobile" design L88-109): balance card, Scan
// banner, a horizontal Top-movers strip, and the holdings card. Same live hooks
// as the desktop HomeMenu — only the composition is phone-native.
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { STOCKS } from "@/lib/tokens";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { PIcon, usd, pctStr, priceStr, dcol, chartPaths, panel, type ChatNav } from "./chatKit";
import { portfolioDayCurve } from "@/lib/portfolioCurve";
import { useHidden, setHidden, money } from "./privacy";

export function HomeMobile({ nav }: { nav: ChatNav }) {
  const hidden = useHidden();
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const { data: prices } = usePrices();
  const { data: market } = useMarketSummary();

  const cash = port?.cashUsd ?? 0;
  const invested = port?.investedUsd ?? 0;
  const total = port?.totalUsd ?? 0;
  const monQty = (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA")?.qty ?? 0;
  const holdings: Holding[] = (port?.holdings ?? []).filter((h) => h.asset.symbol !== "MONVERA").slice().sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const dayU = holdings.reduce((s, h) => s + (h.valueUsd ?? 0) * ((h.dayChangePct ?? 0) / 100), 0);

  // Real intraday value of what they actually hold — never a synthetic wave
  // under a real balance (that reads as their money moving when it isn't).
  const day = portfolioDayCurve(port?.holdings ?? []);
  const home = day ? chartPaths(day.curve, 380, 90) : null;

  const strip = STOCKS.map((a) => ({ sym: a.symbol, name: a.name, day: market?.summary[a.symbol]?.dayChangePct ?? 0, price: prices?.prices[a.symbol]?.priceUsd }))
    .filter((m) => m.price !== undefined && m.day !== 0)
    .sort((a, b) => Math.abs(b.day) - Math.abs(a.day))
    .slice(0, 8);

  return (
    <main className="scr" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 14px 96px" }}>
      {/* balance */}
      <div style={panel({ borderRadius: 22, padding: 20 })}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>Total balance</div>
          <button onClick={() => setHidden(!hidden)} aria-label={hidden ? "Show balances" : "Hide balances"} style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-3)" }}>
            <PIcon name={hidden ? "ph-eye-slash" : "ph-eye"} size={14} weight="bold" />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
          <span className="serif tnum" style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-.02em", lineHeight: 1 }}>{money(total, hidden)}</span>
          <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: dcol(dayU) }}>{(dayU >= 0 ? "+" : "−") + "$" + Math.abs(dayU).toFixed(2)}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          {home ? (
            <svg viewBox="0 0 380 90" preserveAspectRatio="none" width="100%" height={90} style={{ display: "block" }}>
              <defs><linearGradient id="mvmHome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
              <path d={home.area} fill="url(#mvmHome)" />
              <path d={home.line} fill="none" stroke="var(--primary)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--ink-3)" }}>
              {holdings.length ? "Not enough movement today to chart yet." : "Your chart appears once you own something."}
            </div>
          )}
        </div>
        <div style={{ display: "flex", marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", color: "var(--ink-3)" }}>Cash</div><div className="tnum" style={{ fontSize: 16, fontWeight: 600, marginTop: 1 }}>{money(cash, hidden)}</div></div>
          <div style={{ flex: 1, paddingLeft: 14, borderLeft: "1px solid var(--line-2)" }}><div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", color: "var(--ink-3)" }}>Invested</div><div className="tnum" style={{ fontSize: 16, fontWeight: 600, marginTop: 1 }}>{money(invested, hidden)}</div></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={nav.openSend} style={{ flex: 1, height: 42, border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}><PIcon name="ph-paper-plane-tilt" size={16} style={{ color: "var(--primary)" }} /> Send</button>
          <button onClick={nav.openReceive} style={{ flex: 1, height: 42, border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}><PIcon name="ph-qr-code" size={16} style={{ color: "var(--primary)" }} /> Receive</button>
        </div>
      </div>

      {/* scan banner */}
      <button onClick={() => nav.openCanvas("scan")} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "11px 14px", border: "1px solid var(--line)", borderRadius: 18, background: "linear-gradient(120deg,color-mix(in srgb,var(--primary) 13%,transparent),transparent 70%),var(--panel)", textAlign: "left", marginTop: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}><PIcon name="ph-camera" size={17} /></span>
        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Scan to Buy</span><span style={{ display: "block", fontSize: 11, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Snap a product — Vera invests in it</span></span>
        {monQty >= 100_000
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--primary)", flex: "none" }}><PIcon name="ph-check-circle" size={12} weight="fill" /> Unlocked</span>
          : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--ink-3)", flex: "none" }}><PIcon name="ph-lock" size={12} /> 100k</span>}
      </button>

      {/* top movers strip */}
      {strip.length > 0 && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-2)", margin: "14px 2px 0" }}>Top movers</div>
          <div className="scr" style={{ display: "flex", gap: 9, overflowX: "auto", marginTop: 9 }}>
            {strip.map((m) => (
              <button key={m.sym} onClick={() => nav.openCanvas("holding", m.sym)} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 7, height: 38, padding: "0 12px 0 6px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink)" }}>
                <AssetTile asset={toTile(m.sym, m.name)} size={26} radius={13} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{m.sym}</span>
                <span className="tnum" style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>{m.price !== undefined ? priceStr(m.price) : "—"}</span>
                <span className="tnum" style={{ fontSize: 11.5, fontWeight: 700, color: dcol(m.day) }}>{pctStr(m.day)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* holdings — naked list, straight on the aurora (no box) */}
      <div style={{ marginTop: 16, padding: "0 4px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 4px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-2)" }}>Your holdings</span>
          <button onClick={() => nav.openCanvas("portfolio")} style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)" }}>View all</button>
        </div>
        {holdings.length === 0 ? (
          <div style={{ padding: "12px 0", fontSize: 13, color: "var(--ink-2)" }}>Nothing yet — ask Vera to put your cash to work.</div>
        ) : holdings.map((h, i) => {
          const tile = toTile(h.asset.symbol, h.asset.name);
          const day = h.dayChangePct ?? 0;
          const w = invested > 0 ? ((h.valueUsd ?? 0) / invested) * 100 : 0;
          return (
            <button key={h.asset.symbol} onClick={() => nav.openCanvas("holding", h.asset.symbol)} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "12px 2px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)", textAlign: "left" }}>
              <AssetTile asset={tile} size={34} radius={10} />
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: 500, fontSize: 14 }}>{tile.name}</span><span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>{w.toFixed(0)}% of portfolio</span></span>
              <span style={{ textAlign: "right" }}><span className="tnum" style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{h.valueUsd !== undefined ? usd(h.valueUsd) : "—"}</span><span className="tnum" style={{ display: "block", fontSize: 11, fontWeight: 600, color: dcol(day) }}>{pctStr(day)}</span></span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
