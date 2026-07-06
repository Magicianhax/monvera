"use client";

// Market — flat "Ledger" instrument list. A searchable list of the REAL
// ALL_ASSETS universe (lib/tokens.ts), categorised + decorated with
// plain-language display copy (displayAssets.ts). Prices are live on-chain spot;
// day moves + sparklines are real market data (/api/market). Assets not yet
// buyable in-app (d.coming) are grouped under a "Coming soon" section label.
// Layout: neutral surface cards in the 22px gutter,
// sections bounded top+bottom by --line — no card-per-row.
import { useMemo, useRef, useState, useEffect } from "react";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { Icon, AssetTile, Sparkline } from "@/components/design";
import { usd } from "@/lib/format";
import { matchesSearch, THEMES } from "@/lib/marketSearch";
import { useWatchlist } from "@/lib/watchlist";
import { WatchStar } from "@/components/lite/WatchStar";
import { Pager } from "./primitives";

type Disp = ReturnType<typeof displayFor>;
type Row = { asset: (typeof ALL_ASSETS)[number]; d: Disp };

// Filter chips: plain categories plus a few high-signal themes (AI, Semis…).
const WATCHLIST_FILTER = "★ Watchlist";
const FILTERS: { label: string; test: (d: Disp, symbol: string) => boolean }[] = [
  { label: "All", test: () => true },
  { label: WATCHLIST_FILTER, test: () => true }, // membership checked reactively in the component
  { label: "AI", test: (_d, s) => THEMES.ai.includes(s) },
  { label: "Semis", test: (_d, s) => THEMES.semiconductor.includes(s) },
  { label: "Tech", test: (d) => d.cat === "Tech" },
  { label: "Funds", test: (d) => d.cat === "Funds" },
  { label: "Consumer", test: (d) => d.cat === "Consumer" },
  { label: "Finance", test: (d) => d.cat === "Finance" },
  { label: "Crypto", test: (_d, s) => THEMES.crypto.includes(s) },
  { label: "Quantum", test: (_d, s) => THEMES.quantum.includes(s) },
  { label: "Space", test: (_d, s) => THEMES.space.includes(s) },
  { label: "Energy", test: (d) => d.cat === "Energy" },
  { label: "Health", test: (d) => d.cat === "Health" },
];

const PER_PAGE = 20;

export function MarketScreen({
  go,
  initialFilter,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  initialFilter?: string;
}) {
  // Theme deep-links (Discover rails etc.) arrive as initialFilter strings the
  // smart search understands ("ai", "space"); watchlist is the only chip filter.
  const [q, setQ] = useState(initialFilter && initialFilter !== "watchlist" ? initialFilter : "");
  const [filterIdx, setFilterIdx] = useState(() =>
    initialFilter === "watchlist" ? FILTERS.findIndex((f) => f.label === WATCHLIST_FILTER) : 0,
  );
  const [page, setPage] = useState(0);
  const watched = useWatchlist();
  const { data: prices, isLoading: pricesLoading } = usePrices();
  const { data: marketData, isLoading: marketLoading } = useMarketSummary();

  // First-load: no live price/market data has arrived yet. Show skeletons instead
  // of rows whose day% would be a presentational fallback dressed up as real.
  const firstLoad = pricesLoading || marketLoading;

  // Scroll the selected filter chip into view when it changes.
  const activeChipRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [filterIdx]);

  const list = useMemo(() => {
    const filter = FILTERS[filterIdx];
    const watchOnly = filter.label === WATCHLIST_FILTER;
    return ALL_ASSETS.map((asset) => ({ asset, d: displayFor(asset.symbol, asset.name) }))
      .filter(
        ({ asset, d }) =>
          (watchOnly ? watched.includes(asset.symbol) : filter.test(d, asset.symbol)) &&
          matchesSearch(asset.symbol, d.name, d.cat, q),
      );
  }, [q, filterIdx, watched]);

  // Reset to the first page whenever the filter or query changes the result set.
  useEffect(() => setPage(0), [q, filterIdx]);

  const pageCount = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = list.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const renderRow = ({ asset, d }: Row) => {
    // Real market day move + sparkline when the asset has a live source; the day%
    // stays neutral (never a fake +/-) until live data actually arrives.
    const live = marketData?.summary[asset.symbol];
    const day = live?.dayChangePct ?? d.day;
    const spark = live?.spark ?? d.spark;
    const up = day >= 0;
    const dayColor = live ? (up ? "var(--pos)" : "var(--neg)") : "var(--ink-3)";
    // Price, most authoritative first: the on-chain Chainlink spot, else the
    // latest real market close (the spark's last point — same Yahoo source as
    // the % and chart), else the indicative reference. Most tokens have no
    // Chainlink feed on Robinhood Chain yet, so the market close fills the gap.
    const livePrice = prices?.prices[asset.symbol]?.priceUsd;
    const marketLast = live?.spark?.length ? live.spark[live.spark.length - 1] : undefined;
    const shownPrice = livePrice ?? marketLast ?? d.price;
    return (
      <button
        key={asset.symbol}
        onClick={() => go("asset", { symbol: asset.symbol })}
        className="row"
        style={{
          padding: "14px 16px",
          background: "var(--surface)",
          borderRadius: "var(--rr)",
          boxShadow: "var(--shadow)",
          opacity: d.coming ? 0.62 : 1,
        }}
      >
        <AssetTile asset={d} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              fontSize: 16,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {d.name}
          </div>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
            {d.ticker ?? asset.symbol}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          <Sparkline data={spark} color={up ? "var(--pos)" : "var(--neg)"} />
        </div>
        <div style={{ textAlign: "right", minWidth: 62 }}>
          <div className="tnum" style={{ fontWeight: 500, fontSize: 15.5 }}>
            {shownPrice !== undefined ? usd(shownPrice) : "—"}
          </div>
          <div className="tnum" style={{ fontSize: 12.5, fontWeight: 500, color: dayColor }}>
            {(up ? "+" : "") + day.toFixed(2)}%
          </div>
        </div>
        <WatchStar symbol={asset.symbol} size={19} />
      </button>
    );
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* header — h1 left, result count right on the same baseline */}
      <div
        style={{
          padding: "12px 22px 0",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Market
        </h1>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flex: "none" }}>
          <button
            className="tap"
            onClick={() => go("discover")}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 99, background: "var(--primary-soft)", color: "var(--primary)", fontSize: 12.5, fontWeight: 600 }}
          >
            <Icon name="grid" size={14} /> Discover
          </button>
          <button
            className="tap"
            onClick={() => go("screener")}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 99, background: "var(--surface-2)", color: "var(--ink)", fontSize: 12.5, fontWeight: 600 }}
          >
            <Icon name="sliders" size={14} /> Screener
          </button>
        </span>
      </div>

      {/* search */}
      <div style={{ padding: "14px 22px 0" }}>
        <div
          className="field"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 15px",
          }}
        >
          <Icon name="search" size={20} style={{ color: "var(--ink-3)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search companies & funds"
            aria-label="Search companies and funds"
            style={{ flex: 1, fontSize: 16 }}
          />
        </div>
      </div>

      {/* filters — categories + high-signal themes */}
      <div
        style={{ display: "flex", gap: 8, padding: "14px 22px 0", overflowX: "auto", flexShrink: 0 }}
      >
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            ref={filterIdx === i ? activeChipRef : undefined}
            onClick={() => setFilterIdx(i)}
            className={`chip tap ${filterIdx === i ? "is-on" : ""}`}
            style={{ flex: "none" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* the list — neutral surface cards (match the Home ledger) */}
      {firstLoad ? (
        <section aria-hidden style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, padding: "0 22px" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "14px 16px",
                background: "var(--surface)",
                borderRadius: "var(--rr)",
                boxShadow: "var(--shadow)",
              }}
            >
              <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 5, flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="skeleton" style={{ width: "52%", height: 14, borderRadius: 5 }} />
                <div className="skeleton" style={{ width: "30%", height: 11, borderRadius: 5, marginTop: 8 }} />
              </div>
              <div className="skeleton" style={{ width: 64, height: 24, borderRadius: 5 }} />
              <div style={{ minWidth: 70 }}>
                <div className="skeleton" style={{ width: 56, height: 15, borderRadius: 5, marginLeft: "auto" }} />
                <div className="skeleton" style={{ width: 40, height: 12, borderRadius: 5, marginTop: 7, marginLeft: "auto" }} />
              </div>
            </div>
          ))}
        </section>
      ) : list.length === 0 ? (
        <p
          style={{
            margin: "14px 0 0",
            padding: "24px 22px",
            fontSize: 14.5,
            color: "var(--ink-2)",
          }}
        >
          {FILTERS[filterIdx].label === WATCHLIST_FILTER && !q
            ? "Your watchlist is empty. Tap the star on any stock to follow it here."
            : "No companies or funds match that. Try a theme like “AI”, “ETF”, or “quantum”."}
        </p>
      ) : (
        <>
          <section className="stagger" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, padding: "0 22px" }}>
            {paged.map((r) => renderRow(r))}
          </section>
          {pageCount > 1 && <Pager page={safePage} pageCount={pageCount} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
