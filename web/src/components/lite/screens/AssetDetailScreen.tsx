"use client";

// AssetDetail — Pro asset view (screens_pro.jsx · AssetDetail). Shows a REAL
// price chart (/api/market: Yahoo Finance for the equities our xStocks track,
// CoinGecko for the token tier), plain-language about copy, and the user's REAL
// position in this asset (from usePortfolio). Buy/Sell open the manual Trade
// screen (useQuote + useSwap, gasless). Tiers the executor can't route yet are
// flagged "Coming soon".
//
// Layout: compact ticker header → centered price hero (updates live while you
// scrub the chart) → full-bleed scrubbable chart → range chips → grouped cards
// (position, range, about, key facts) → sticky Buy/Sell bar.
import { useState, type CSSProperties } from "react";
import { ALL_ASSETS, type Asset } from "@/lib/tokens";
import { usePortfolio } from "@/hooks/useBalances";
import { usePrice } from "@/hooks/usePrices";
import { useMarketHistory, useMarketSummary, type MarketRange } from "@/hooks/useMarket";
import { useTransactions } from "@/hooks/useTransactions";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { whyItMoved } from "@/lib/marketContext";
import { toWalletEvents } from "@/lib/walletActivity";
import { sinceBought } from "@/lib/sinceBought";
import { Icon, PriceChart, CountUp, BottomSheet } from "@/components/design";
import { useNotifyActions } from "@/hooks/useNotifications";
import { usd, addressUrl, shortAddress } from "@/lib/format";
import { WatchStar } from "@/components/lite/WatchStar";
import { iconBtn } from "./primitives";

const RANGES = ["1D", "1W", "1M", "1Y", "All"];

// Ledger section header — strong sans in the 22px gutter.
const sectionHead: CSSProperties = {
  margin: "26px 22px 10px",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink-2)",
};

// Grouped card: one rounded surface holding the section's rows.
const groupCard: CSSProperties = {
  margin: "0 22px",
  background: "var(--surface)",
  borderRadius: "var(--rr)",
  boxShadow: "var(--shadow)",
  overflow: "hidden",
};

const groupRow = (first: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  padding: "14px 16px",
  borderTop: first ? "none" : "1px solid var(--line-2)",
  fontSize: 14.5,
});

// Compact volume: 46,819,546 -> "46.8M".
function fmtVolume(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function AssetDetailScreen({
  go,
  symbol,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
}) {
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertDir, setAlertDir] = useState<"above" | "below">("above");
  const [alertPx, setAlertPx] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const { createAlert } = useNotifyActions();
  const asset: Asset = ALL_ASSETS.find((a) => a.symbol === symbol) ?? ALL_ASSETS[0];
  const d = displayFor(asset.symbol, asset.name);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol);
  const { priceUsd: livePrice, isLoading: priceLoading } = usePrice(asset.symbol);
  const coming = Boolean(d.coming);
  const [r, setR] = useState(2);
  // Chart scrub: while the finger is down, the hero shows the price at that point.
  const [scrub, setScrub] = useState<{ price: number; index: number } | null>(null);

  // REAL market history for the selected range (server-cached; keepPreviousData
  // makes range switches seamless). Assets with no live source (or an upstream
  // outage) fall back to the windowed reference series so the chart never blanks.
  const { data: market, isLoading: marketLoading } = useMarketHistory(
    asset.symbol,
    RANGES[r] as MarketRange,
  );
  // "Why it moved" — honest day-move context vs sector peers + SPY.
  const { data: summary } = useMarketSummary();
  const why = whyItMoved(asset.symbol, summary?.summary);

  // "Since you bought" — the stock's market move from the first-buy date to now
  // (only when held). Entry date = oldest buy of this symbol in the tx feed;
  // entry close comes from a 1Y dated history (fetched only when held).
  const { data: txs } = useTransactions(holding ? address ?? undefined : undefined);
  const { data: yearHist } = useMarketHistory(holding ? asset.symbol : undefined, "1Y");
  const entryTs = holding
    ? toWalletEvents(txs ?? [])
        .filter((e) => e.kind === "buy" && e.symbol === asset.symbol && e.timestamp)
        .reduce<number | undefined>((min, e) => (min === undefined ? e.timestamp : Math.min(min, e.timestamp!)), undefined)
    : undefined;
  // First-load only: neither live price nor market history has arrived yet, so a
  // shown number would be the reference fallback dressed as real. Skeleton instead.
  // keepPreviousData keeps later range switches seamless (isLoading stays false).
  const firstLoad = priceLoading || marketLoading;
  const RANGE_FRAC = [0.18, 0.38, 0.6, 0.82, 1];
  const fallbackSpark = (() => {
    const s = d.spark ?? [];
    if (s.length < 2) return s;
    const n = Math.max(2, Math.round(s.length * (RANGE_FRAC[r] ?? 1)));
    return s.slice(s.length - n);
  })();
  const sparkData = market?.series ?? fallbackSpark;
  // Price, most authoritative first: on-chain Chainlink spot, else the latest
  // real market close (same Yahoo source as the chart), else the reference.
  const marketLast = market?.series?.length ? market.series[market.series.length - 1] : undefined;
  const shownPrice = livePrice ?? marketLast ?? d.price;
  const since = sinceBought(entryTs, yearHist?.timestamps, yearHist?.series, shownPrice);
  // Change across the selected range — real when we have market data (1D is vs
  // the previous session's close, like a broker shows it).
  const rangeChange =
    market?.changePct ??
    (sparkData.length > 1
      ? ((sparkData[sparkData.length - 1] - sparkData[0]) / sparkData[0]) * 100
      : d.day);

  // While scrubbing, the hero reflects the scrub point: price at the finger and
  // the move from the range's start to there (Robinhood-style). Otherwise it's
  // the live price + whole-range change.
  const base0 = sparkData[0];
  const heroPrice = scrub ? scrub.price : shownPrice;
  const heroChange =
    scrub && base0 ? ((scrub.price - base0) / base0) * 100 : rangeChange;
  const winUp = heroChange >= 0;
  const dollarMove = scrub
    ? scrub.price - (base0 ?? scrub.price)
    : shownPrice !== undefined
      ? shownPrice - shownPrice / (1 + rangeChange / 100)
      : undefined;
  // Whole-range direction drives the line/fill color (stable while scrubbing).
  const lineUp = rangeChange >= 0;

  // Key facts — flat two-column hairline table under About.
  const TYPE_LABEL: Record<string, string> = {
    stock: "Stock",
    fund: "Fund · ETF",
    safe: "Cash · earns yield",
    crypto: "Crypto",
  };
  // Every tradable here is a tokenized real-world asset that tracks the real
  // share 1:1 — funds (ETFs) read "Tokenized fund", the cash dollar reads
  // "Digital dollar", everything else "Tokenized stock". No yield/coin branches.
  const heldAs =
    d.kind === "safe" ? "Digital dollar" : d.kind === "fund" ? "Tokenized fund" : "Tokenized stock";
  const meta = market?.meta ?? null;
  const facts: { k: string; v: string }[] = [
    { k: "Type", v: TYPE_LABEL[d.kind ?? "stock"] ?? "Stock" },
    { k: "Category", v: d.cat },
    ...(meta?.exchange ? [{ k: "Exchange", v: meta.exchange }] : []),
    ...(meta?.volume ? [{ k: "Volume (1D)", v: fmtVolume(meta.volume) }] : []),
    { k: "Held as", v: heldAs },
    { k: "Network", v: "Robinhood Chain" },
  ];
  // 52-week range bar: where the live price sits between the year's low & high.
  const lo = meta?.fiftyTwoWeekLow;
  const hi = meta?.fiftyTwoWeekHigh;
  const rangePos =
    lo !== undefined && hi !== undefined && hi > lo && shownPrice !== undefined
      ? Math.max(0, Math.min(1, (shownPrice - lo) / (hi - lo)))
      : null;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      {/* header — back + ticker + name inline, small */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-.02em",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span>{d.ticker ?? asset.symbol}</span>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: "var(--ink-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {d.name}
          </span>
        </h1>
        {coming && (
          <span
            style={{
              flex: "none",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--ink-2)",
              background: "var(--surface-2)",
              borderRadius: 999,
              padding: "4px 10px",
            }}
          >
            Coming soon
          </span>
        )}
        <button className="tap" onClick={() => setAlertOpen(true)} aria-label="Set a price alert"
          style={{ width: 34, height: 34, borderRadius: 99, display: "grid", placeItems: "center", background: "var(--surface-2)", color: "var(--ink-2)", flex: "none" }}>
          <Icon name="bell" size={17} />
        </button>
        <WatchStar symbol={asset.symbol} size={22} />
      </div>

      {/* price hero — focal block, centered: big number + its move together */}
      {firstLoad ? (
        <div
          className="anim-rise"
          style={{ padding: "14px 22px 0", display: "grid", justifyItems: "center", gap: 9 }}
          aria-label="Loading price"
        >
          <div className="skeleton" style={{ width: 168, height: 36, borderRadius: 5 }} />
          <div className="skeleton" style={{ width: 132, height: 14, borderRadius: 5 }} />
        </div>
      ) : (
        <div className="anim-rise" style={{ padding: "14px 22px 0", textAlign: "center" }}>
          <div className="tnum" style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.02em" }}>
            {heroPrice === undefined ? (
              "—"
            ) : scrub ? (
              // Plain (no CountUp) while scrubbing so it tracks the finger instantly.
              usd(heroPrice)
            ) : (
              <CountUp to={heroPrice} />
            )}
          </div>
          <div
            className="tnum"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: winUp ? "var(--pos)" : "var(--neg)",
              marginTop: 3,
            }}
          >
            {dollarMove !== undefined && Number.isFinite(dollarMove) && (
              <>{(winUp ? "+" : "") + usd(dollarMove)}{" · "}</>
            )}
            {(winUp ? "+" : "") + heroChange.toFixed(2)}%{" "}
            <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>· {RANGES[r]}</span>
          </div>
        </div>
      )}

      {/* chart — full-bleed, no frame; chart-shaped skeleton on first load */}
      <div className="anim-rise" style={{ animationDelay: ".05s", marginTop: 12 }}>
        {firstLoad ? (
          <div
            className="skeleton"
            style={{ height: 184, borderRadius: 0 }}
            aria-label="Loading chart"
          />
        ) : (
          <PriceChart
            data={sparkData}
            up={lineUp}
            height={184}
            onScrub={setScrub}
            label={`${d.name} price chart, ${lineUp ? "up" : "down"} ${Math.abs(rangeChange).toFixed(1)}% over ${RANGES[r]}. Touch and drag to read the price at any point.`}
          />
        )}
      </div>

      {/* range chips — under the chart (safe now that screens scroll instead of
          crushing children; see the .screen>* flex-shrink rule). */}
      <div style={{ display: "flex", gap: 8, padding: "14px 22px 0", overflowX: "auto", justifyContent: "center" }}>
        {RANGES.map((rr, idx) => (
          <button
            key={rr}
            onClick={() => setR(idx)}
            className={`chip tap ${r === idx ? "is-on" : ""}`}
            aria-pressed={r === idx}
            style={{ flex: "none", height: 32, fontSize: 13, fontWeight: 500 }}
          >
            {rr}
          </button>
        ))}
      </div>

      {/* why it moved — honest plain-words context (market move, not a headline) */}
      {why && (
        <div style={{ ...groupCard, marginTop: 16, padding: "13px 15px", display: "flex", gap: 11 }}>
          <Icon
            name={why.up ? "trend" : "trendDown"}
            size={18}
            style={{ flex: "none", marginTop: 1, color: why.up ? "var(--pos)" : "var(--neg)" }}
          />
          <div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{why.text}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>
              That&apos;s today&apos;s market move, not a news read.
            </div>
          </div>
        </div>
      )}

      {/* your position — grouped card */}
      {holding && (
        <section>
          <h2 style={sectionHead}>Your position</h2>
          <div className="stagger-in" style={groupCard}>
            <div style={groupRow(true)}>
              <span style={{ color: "var(--ink-2)" }}>Value</span>
              <span className="tnum" style={{ fontWeight: 600, color: "var(--ink)" }}>
                {holding.valueUsd !== undefined ? usd(holding.valueUsd) : "—"}
              </span>
            </div>
            <div style={groupRow(false)}>
              <span style={{ color: "var(--ink-2)" }}>Shares</span>
              <span className="tnum" style={{ fontWeight: 600, color: "var(--ink)" }}>
                {holding.qty.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </span>
            </div>
            {shownPrice !== undefined && (
              <div style={groupRow(false)}>
                <span style={{ color: "var(--ink-2)" }}>Price</span>
                <span className="tnum" style={{ fontWeight: 600, color: "var(--ink)" }}>
                  {usd(shownPrice)}
                </span>
              </div>
            )}
          </div>
          {since && (
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "10px 22px 0", lineHeight: 1.5 }}>
              {d.name} is{" "}
              <b className="tnum" style={{ color: since.up ? "var(--pos)" : "var(--neg)" }}>
                {since.up ? "up" : "down"} {Math.abs(since.pct).toFixed(1)}%
              </b>{" "}
              since your first buy on{" "}
              {new Date(since.entryTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. That&apos;s
              the stock&apos;s move, not your gain.
            </p>
          )}
        </section>
      )}

      {/* 52-week range — card with a position bar (real, from the chart meta) */}
      {rangePos !== null && lo !== undefined && hi !== undefined && (
        <section>
          <h2 style={sectionHead}>52-week range</h2>
          <div className="stagger-in" style={{ ...groupCard, padding: "16px 16px 14px" }}>
            <div
              style={{
                position: "relative",
                height: 6,
                borderRadius: 999,
                background: "var(--surface-2)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${rangePos * 100}%`,
                  borderRadius: 999,
                  background: "var(--primary)",
                }}
              />
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: `${rangePos * 100}%`,
                  top: "50%",
                  width: 12,
                  height: 12,
                  marginLeft: -6,
                  marginTop: -6,
                  borderRadius: "50%",
                  background: "var(--primary)",
                  border: "2px solid var(--surface)",
                  boxShadow: "0 0 0 2px var(--primary)",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                {usd(lo)}
                <span style={{ color: "var(--ink-3)" }}> low</span>
              </span>
              <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                <span style={{ color: "var(--ink-3)" }}>high </span>
                {usd(hi)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* about — grouped card */}
      <section>
        <h2 style={sectionHead}>About</h2>
        <p style={{ ...groupCard, margin: "0 22px", padding: "14px 16px", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
          {d.desc}
        </p>
      </section>

      {/* key facts — grouped card */}
      <section style={{ paddingBottom: 24 }}>
        <h2 style={sectionHead}>Key facts</h2>
        <div className="stagger-in" style={groupCard}>
          {facts.map((f, i) => (
            <div key={f.k} style={groupRow(i === 0)}>
              <span style={{ color: "var(--ink-2)" }}>{f.k}</span>
              <span style={{ fontWeight: 500, color: "var(--ink)", textAlign: "right" }}>
                {f.v}
              </span>
            </div>
          ))}
          {/* Contract — real on-chain token address, opens the explorer */}
          <a
            href={addressUrl(asset.address)}
            target="_blank"
            rel="noreferrer"
            style={{ ...groupRow(false), textDecoration: "none" }}
          >
            <span style={{ color: "var(--ink-2)" }}>Contract</span>
            <span
              className="mono"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 500, color: "var(--primary)" }}
            >
              {shortAddress(asset.address)}
              <Icon name="arrowUR" size={13} />
            </span>
          </a>
        </div>
      </section>

            {/* price alert — one honest trigger, checked every 15 minutes */}
      <BottomSheet open={alertOpen} onClose={() => setAlertOpen(false)} title={`Alert me on ${d.name}`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {(["above", "below"] as const).map((dir) => (
            <button key={dir} className={`chip tap ${alertDir === dir ? "is-on" : ""}`} onClick={() => setAlertDir(dir)}
              style={{ flex: 1, height: 38, justifyContent: "center" }}>
              Goes {dir}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: "var(--r)", background: "var(--surface-2)" }}>
          <span className="tnum" style={{ fontSize: 20, fontWeight: 500 }}>$</span>
          <input inputMode="decimal" value={alertPx} onChange={(e) => setAlertPx(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={heroPrice !== undefined ? heroPrice.toFixed(2) : "0.00"} aria-label="Alert price"
            style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 20, fontWeight: 500, color: "var(--ink)" }} />
        </div>
        <button className="btn btn-primary btn-block btn-lg tap" style={{ marginTop: 16 }}
          disabled={alertBusy || !(parseFloat(alertPx) > 0)}
          onClick={async () => {
            setAlertBusy(true);
            try {
              await createAlert({ symbol: asset.symbol, direction: alertDir, threshold: parseFloat(alertPx) });
              setAlertOpen(false);
              setAlertPx("");
            } catch {
              /* surfaced by the alerts list staying unchanged */
            } finally {
              setAlertBusy(false);
            }
          }}>
          {alertBusy ? "Saving..." : "Set alert"}
        </button>
        <p style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
          Checked every 15 minutes. You will get a notification in the app; the alert turns itself off after it fires.
        </p>
      </BottomSheet>

      {/* CTA — flat sticky bar: solid surface, hairline top */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "14px 22px calc(16px + env(safe-area-inset-bottom))",
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
        }}
      >
        {!holding && !coming && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>
            You don&apos;t own this yet
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {/* Sell only shows when there's actually something to sell — otherwise Buy
              goes full-width instead of a disabled, reasonless Sell button. */}
          {holding && (
            <button
              className="btn btn-ghost tap"
              style={{ flex: 1 }}
              disabled={coming}
              onClick={() => go("trade", { symbol: asset.symbol, side: "sell" })}
            >
              Sell
            </button>
          )}
          <button
            className="btn btn-primary tap"
            style={{ flex: holding ? 2 : 1 }}
            disabled={coming}
            onClick={() => go("trade", { symbol: asset.symbol, side: "buy" })}
          >
            {coming ? "Coming soon" : "Buy"}
          </button>
        </div>
      </div>
    </div>
  );
}
