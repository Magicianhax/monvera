"use client";

// Desktop Market — the full tradable universe as the approved "Monvera Desktop"
// data list: an eyebrow + title, an inline search, a category chip row, and a
// full-width asset table (star · asset · category · price · day · 7-day spark).
// Same live data as the mobile MarketScreen (usePrices + useMarketSummary +
// the device-local watchlist); only the composition is desktop-native.
import { useState } from "react";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { useWatchlist, toggleWatch } from "@/lib/watchlist";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { matchesSearch } from "@/lib/marketSearch";
import { AssetTile, Sparkline } from "@/components/design";
import { DIcon, priceStr, pctStr, dcol, Panel } from "./deskKit";

type Go = (screen: string, params?: Record<string, unknown>) => void;

interface Chip {
  label: string;
  watch?: boolean;
  kw?: string; // keyword handed to matchesSearch for theme/category chips
}
// The design's CHIPS list — theme/category filters resolved through the shared
// matchesSearch helper (AI = curated theme set; the rest = category synonyms).
const CHIPS: Chip[] = [
  { label: "All" },
  { label: "★ Watchlist", watch: true },
  { label: "AI", kw: "ai" },
  { label: "Tech", kw: "tech" },
  { label: "Consumer", kw: "consumer" },
  { label: "Finance", kw: "finance" },
  { label: "Energy", kw: "energy" },
  { label: "Funds", kw: "funds" },
];

const GRID = "36px 2.4fr 1.1fr 1fr 1fr 1.1fr";

export function DesktopMarket({ go, initialFilter }: { go: Go; initialFilter?: string }) {
  const { data: prices, isLoading: pricesLoading } = usePrices();
  const { data: marketData, isLoading: marketLoading } = useMarketSummary();
  const watched = useWatchlist();
  const [q, setQ] = useState(initialFilter && initialFilter !== "watchlist" ? initialFilter : "");
  const [chip, setChip] = useState<string>(initialFilter === "watchlist" ? "★ Watchlist" : "All");
  const firstLoad = pricesLoading || marketLoading;

  const active = CHIPS.find((c) => c.label === chip) ?? CHIPS[0];

  const rows = ALL_ASSETS.filter((a) => {
    const d = displayFor(a.symbol, a.name);
    const passChip = active.watch ? watched.includes(a.symbol) : active.kw ? matchesSearch(a.symbol, d.name, d.cat, active.kw) : true;
    const passSearch = q.trim() === "" ? true : matchesSearch(a.symbol, d.name, d.cat, q);
    return passChip && passSearch;
  });

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px 60px" }}>
        {/* header — eyebrow + title + inline search */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 }}>The whole market, tokenized</div>
            <h1 className="serif" style={{ margin: 0, fontSize: 27 }}>Market</h1>
          </div>
          <div style={{ position: "relative", minWidth: 240, flex: 1, maxWidth: 320 }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "grid" }}>
              <DIcon name="search" size={17} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stocks & funds…"
              aria-label="Search market"
              style={{ height: 42, width: "100%", padding: "0 14px 0 38px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 14, fontFamily: "inherit", outline: "none" }}
            />
          </div>
        </header>

        {/* filter chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          {CHIPS.map((c) => {
            const on = c.label === chip;
            return (
              <button
                key={c.label}
                onClick={() => setChip(c.label)}
                className="desk-chip"
                style={{
                  height: 34,
                  padding: "0 15px",
                  border: "1px solid " + (on ? "var(--primary)" : "var(--line)"),
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  background: on ? "var(--primary)" : "var(--surface-2)",
                  color: on ? "var(--primary-ink)" : "var(--ink-2)",
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* asset table */}
        <Panel style={{ marginTop: 20, padding: "8px 10px 10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            <span />
            <span>Asset</span>
            <span>Category</span>
            <span style={{ textAlign: "right" }}>Price</span>
            <span style={{ textAlign: "right" }}>Day</span>
            <span style={{ textAlign: "center" }}>7 days</span>
          </div>

          {rows.map((a) => {
            const d = displayFor(a.symbol, a.name);
            const live = marketData?.summary[a.symbol];
            const livePrice = prices?.prices[a.symbol]?.priceUsd;
            const marketLast = live?.spark?.length ? live.spark[live.spark.length - 1] : undefined;
            const price = livePrice ?? marketLast ?? d.price;
            const day = live?.dayChangePct ?? d.day;
            const spark = live?.spark ?? d.spark;
            const hasLive = Boolean(live) || livePrice !== undefined;
            const muted = d.coming || !hasLive;
            const dayColor = muted ? "var(--ink-3)" : dcol(day);
            const on = watched.includes(a.symbol);
            const toggle = (e: { stopPropagation: () => void }) => {
              e.stopPropagation();
              toggleWatch(a.symbol);
            };
            return (
              <button
                key={a.symbol}
                className="desk-row"
                onClick={() => go("asset", { symbol: a.symbol })}
                style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", width: "100%", padding: "11px 12px", border: "none", borderBottom: "1px solid var(--line-2)", background: "none", textAlign: "left", borderRadius: 10 }}
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
                  aria-pressed={on}
                  onClick={toggle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") toggle(e);
                  }}
                  style={{ display: "grid", placeItems: "center", cursor: "pointer", color: on ? "var(--primary)" : "var(--ink-3)" }}
                >
                  <DIcon name="star" size={17} style={{ fill: on ? "var(--primary)" : "none" }} />
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <AssetTile asset={d} size={34} radius={10} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500, fontSize: 14.5, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>{a.symbol}</span>
                  </span>
                </span>

                <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{d.cat}</span>

                <span className="tnum" style={{ textAlign: "right", fontSize: 14.5, fontWeight: 600 }}>
                  {d.coming ? (
                    <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>Soon</span>
                  ) : price !== undefined ? (
                    priceStr(price)
                  ) : firstLoad ? (
                    <span className="skeleton" style={{ display: "inline-block", width: 52, height: 13, borderRadius: 4 }} />
                  ) : (
                    "—"
                  )}
                </span>

                <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 500, color: dayColor }}>
                  {muted ? "—" : pctStr(day)}
                </span>

                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Sparkline data={spark} color={dcol(day)} />
                </span>
              </button>
            );
          })}

          {rows.length === 0 && <div style={{ padding: "28px", textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>Nothing matches that search.</div>}
        </Panel>
      </div>
    </div>
  );
}
