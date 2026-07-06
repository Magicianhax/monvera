"use client";

// Discover — a browse surface of curated theme rails, so someone new has a few
// structured ways in instead of a flat A-Z list. Each rail is a horizontal
// scroll of small glass tiles (logo · symbol · price · day move). Pure new
// consumer of the already-cached market data (useMarketSummary for the real day
// move, usePrices for live spot); no new API, no fabricated numbers. Rails come
// from the curated THEMES symbol sets (marketSearch.ts), plus two fund rails
// drawn from the real ETF registry. Tapping a tile opens the asset; "See all"
// opens the broader Market.
import { THEMES } from "@/lib/marketSearch";
import { isTradable } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { Icon, AssetTile } from "@/components/design";
import { usd } from "@/lib/format";
import { boxHead, iconBtn } from "./primitives";

// Curated entry points. Thematic rails reuse the marketSearch THEMES sets; the
// two fund rails list real ETFs from lib/tokens. `filter` is the Market view to
// open from "See all" (Market honors "watchlist" today; other values open All).
const RAILS: { title: string; caption: string; filter: string; symbols: string[] }[] = [
  { title: "Artificial intelligence", caption: "The companies building and running AI.", filter: "ai", symbols: THEMES.ai },
  { title: "Semiconductors", caption: "The chips underneath modern computing.", filter: "semiconductor", symbols: THEMES.semiconductor },
  { title: "Space", caption: "Rockets, satellites, and the space economy.", filter: "space", symbols: THEMES.space },
  { title: "Crypto-linked", caption: "Public companies tied to digital assets.", filter: "crypto", symbols: THEMES.crypto },
  { title: "Broad funds", caption: "One fund, many companies at once.", filter: "funds", symbols: ["SPY", "QQQ", "SPMO", "XLK"] },
  { title: "Steady and diversifiers", caption: "Treasuries and commodities, beyond single stocks.", filter: "funds", symbols: ["SGOV", "SLV", "USO"] },
];

const MAX_PER_RAIL = 12;

export function DiscoverScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { data: market } = useMarketSummary();
  const { data: prices } = usePrices();

  const Tile = ({ symbol }: { symbol: string }) => {
    const d = displayFor(symbol);
    const live = market?.summary[symbol];
    // Only ever colour a REAL day move; unknown stays neutral (no fake +/-).
    const day = live?.dayChangePct;
    const hasDay = day !== undefined;
    const up = (day ?? 0) >= 0;
    // Price, most authoritative first: live spot, then the latest real close
    // (spark tail), then the indicative reference — same order as Market.
    const marketLast = live?.spark?.length ? live.spark[live.spark.length - 1] : undefined;
    const price = prices?.prices[symbol]?.priceUsd ?? marketLast ?? d.price;
    return (
      <button
        className="tap"
        onClick={() => go("asset", { symbol })}
        style={{
          flex: "none",
          width: 132,
          background: "var(--surface)",
          border: "1px solid var(--line-2)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow)",
          overflow: "hidden",
          padding: 12,
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <AssetTile asset={d} size={28} radius={9} />
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {symbol}
          </span>
        </div>
        <div>
          <div className="tnum" style={{ fontSize: 14.5, fontWeight: 500 }}>
            {price !== undefined ? usd(price) : "—"}
          </div>
          <div
            className="tnum"
            style={{ fontSize: 12, fontWeight: 500, marginTop: 2, color: hasDay ? (up ? "var(--pos)" : "var(--neg)") : "var(--ink-3)" }}
          >
            {hasDay ? `${up ? "+" : ""}${day.toFixed(2)}%` : "—"}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* header — back + title, mirroring Movers */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Discover</h1>
      </div>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5, margin: "8px 22px 0" }}>
        A few ways to start, grouped by theme.
      </p>

      {RAILS.map((rail) => {
        const symbols = rail.symbols.filter(isTradable).slice(0, MAX_PER_RAIL);
        if (symbols.length === 0) return null;
        return (
          <section key={rail.title} style={{ padding: "22px 0 0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "0 22px" }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ ...boxHead, display: "block", padding: "0 0 2px" }}>{rail.title}</span>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4, paddingBottom: 8 }}>{rail.caption}</div>
              </div>
              <button
                className="tap"
                onClick={() => go("market", { filter: rail.filter })}
                style={{ flex: "none", background: "none", fontSize: 12.5, fontWeight: 500, color: "var(--primary)", padding: "2px 0 8px" }}
              >
                See all
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "0 22px 2px", scrollbarWidth: "none" }}>
              {symbols.map((s) => (
                <Tile key={s} symbol={s} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
