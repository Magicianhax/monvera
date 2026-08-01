"use client";

// Desktop Portfolio ("Owned") — the full-width holdings view, ported to the
// approved Monvera Desktop design: an invested-value summary with cash / total /
// holdings stats, an allocation donut with legend, and the complete holdings
// table. Same live `usePortfolio` data as the mobile PortfolioScreen — only the
// desktop-native composition changes. $MONVERA is the project token (surfaced on
// its own screen), so it is excluded from the stock rows and the allocation ring.
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { AssetTile, Sparkline } from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { DIcon, usd, pctStr, dcol, Panel, Donut } from "./deskKit";

type Go = (screen: string, params?: Record<string, unknown>) => void;

// Share count formatting — tighter precision as the position grows.
const fmtQty = (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: q >= 1000 ? 0 : q >= 1 ? 2 : 4 });

// Shared column grid for the holdings header + rows.
const COLS = "2.2fr 0.9fr 1fr 0.9fr 1fr 0.8fr";

export function DesktopPortfolio({ go }: { go: Go }) {
  const { address } = useSmartAccount();
  const { data: port, isLoading } = usePortfolio(address ?? undefined);

  const cash = port?.cashUsd ?? 0;
  const total = port?.totalUsd ?? 0;
  // Invested value excludes the $MONVERA token (it lives on its own screen).
  const monveraValue = (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA")?.valueUsd ?? 0;
  const invested = Math.max(0, (port?.investedUsd ?? 0) - monveraValue);

  const holdings: Holding[] = (port?.holdings ?? [])
    .filter((h) => h.asset.symbol !== "MONVERA")
    .slice()
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  // Weights are the share of the *shown* (non-MONVERA) holdings, so the ring and
  // the row weights sum to 100% (investedUsd also counts the MONVERA token).
  const stockValue = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  const donutSegs = holdings
    .filter((h) => (h.valueUsd ?? 0) > 0)
    .map((h) => ({ name: toTile(h.asset.symbol, h.asset.name).name, wpct: stockValue > 0 ? ((h.valueUsd ?? 0) / stockValue) * 100 : 0 }));

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px 60px" }}>
        {/* header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 }}>What you own</div>
            <h1 className="serif" style={{ margin: 0, fontSize: 27 }}>Portfolio</h1>
          </div>
          <button onClick={() => go("goal")} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <DIcon name="sparkle" size={17} /> Rebalance with Vera
          </button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 22, marginTop: 24, alignItems: "start" }}>
          {/* ── main column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {/* invested-value summary */}
            <Panel style={{ padding: "22px 24px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-3)" }}>Invested value</span>
              <div className="tnum" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1, marginTop: 4 }}>
                {isLoading ? <span className="skeleton" style={{ display: "inline-block", width: 200, height: 38, borderRadius: 6 }} /> : usd(invested)}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                {[
                  { label: "Cash", value: usd(cash) },
                  { label: "Total", value: usd(total) },
                  { label: "Holdings", value: String(holdings.length) },
                ].map((st) => (
                  <div key={st.label} style={{ flex: "1 1 120px", background: "var(--surface-2)", borderRadius: 12, padding: "12px 15px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--ink-3)" }}>{st.label}</div>
                    <div className="tnum" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{st.value}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* holdings table */}
            <Panel>
              <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--line-2)" }}>
                <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Your holdings</h2>
              </div>
              {holdings.length === 0 ? (
                <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>
                  {isLoading ? "Loading your holdings…" : "You don't own anything yet — start a plan with Vera to get going."}
                </div>
              ) : (
                <div style={{ padding: "8px 10px 10px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: COLS, padding: "0 12px 8px", borderBottom: "1px solid var(--line)", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                    <span>Asset</span>
                    <span style={{ textAlign: "right" }}>Qty</span>
                    <span style={{ textAlign: "center" }}>7 days</span>
                    <span style={{ textAlign: "right" }}>Day</span>
                    <span style={{ textAlign: "right" }}>Value</span>
                    <span style={{ textAlign: "right" }}>Weight</span>
                  </div>
                  {holdings.map((h) => {
                    const tile = toTile(h.asset.symbol, h.asset.name);
                    const day = h.dayChangePct ?? 0;
                    const weight = stockValue > 0 && h.valueUsd !== undefined ? (h.valueUsd / stockValue) * 100 : undefined;
                    return (
                      <button
                        key={h.asset.symbol}
                        className="desk-row"
                        onClick={() => go("asset", { symbol: h.asset.symbol })}
                        style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", width: "100%", padding: 12, background: "none", borderBottom: "1px solid var(--line-2)", textAlign: "left", borderRadius: 10, fontFamily: "inherit" }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                          <AssetTile asset={tile} size={34} radius={10} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 500, fontSize: 14.5, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.name}</span>
                            <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.asset.symbol} · {catFor(h.asset.symbol, h.asset.name)}</span>
                          </span>
                        </span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)" }}>{fmtQty(h.qty)}</span>
                        <span style={{ display: "flex", justifyContent: "center" }}>
                          <Sparkline data={h.spark ?? tile.spark} color={dcol(day)} />
                        </span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 500, color: dcol(day) }}>{h.dayChangePct !== undefined ? pctStr(day) : "—"}</span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 14.5, fontWeight: 600 }}>{h.valueUsd !== undefined ? usd(h.valueUsd) : "—"}</span>
                        <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)" }}>{weight !== undefined ? weight.toFixed(1) + "%" : "—"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* ── right rail ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {donutSegs.length > 0 && (
              <Panel style={{ padding: "20px 18px" }}>
                <h2 style={{ margin: "0 0 16px", fontSize: 14.5, fontWeight: 600 }}>Allocation</h2>
                <Donut segs={donutSegs} count={donutSegs.length} />
              </Panel>
            )}

            <Panel style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <DIcon name="shield" size={18} style={{ color: "var(--primary)" }} />
                <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Portfolio review</h2>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>Let Vera check your concentration, risk, and drift against the market — then rebalance in one tap.</div>
              <button onClick={() => go("review")} className="btn btn-outline" style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 }}>
                <DIcon name="shield" size={17} /> Review with Vera
              </button>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
