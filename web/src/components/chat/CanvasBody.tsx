"use client";

// Right-canvas content per type — the "Monvera Chat" design's canvas panels,
// ported near-verbatim and wired to the app's REAL data hooks (same hooks the
// Desktop* screens use). The canvas CHROME (header/close) lives in ChatApp; this
// renders ONLY the body for a given CanvasType.
//
// Glass idiom: panels MUST inline `background: "var(--panel)"` (with at least
// one style property after it) so the CHAT_THEME_CSS highlight selector bites.
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  PIcon, ChatMark, ChartHover, usd, usd0, pctStr, priceStr, dcol, chartPaths, sparkPath, curve,
  type CanvasType, type ChatNav,
} from "./chatKit";
import { AutopilotCanvas } from "./AutopilotCanvas";
import { ScanCanvas } from "./ScanCanvas";
import { AlertsCanvas } from "./AlertsCanvas";
import { useActivity } from "@/hooks/useActivity";
import { useNotifyActions } from "@/hooks/useNotifications";
import { useWatchlist, useIsWatched, toggleWatch } from "@/lib/watchlist";
import { authHeader } from "@/lib/authedFetch";
import type { PortfolioReview } from "@/lib/server/portfolioReview";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor, toTile, catFor } from "@/lib/displayAssets";
import { matchesSearch } from "@/lib/marketSearch";
import { whyItMoved } from "@/lib/marketContext";
import { useLegacyRecover } from "@/hooks/useLegacyRecover";
import { useHidden, money } from "./privacy";
import { sinceBought } from "@/lib/sinceBought";
import { AssetTile } from "@/components/design";
import { ActivityGlyph } from "@/components/lite/ActivityGlyph";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary, useMarketHistory, useTradability, type MarketRange } from "@/hooks/useMarket";
import { usePortfolio, useUsdcBalance } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useTransactions } from "@/hooks/useTransactions";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useMonveraPrice, useMonveraChart, type TokenChartRange } from "@/hooks/useMonveraToken";
import { MONVERA, MONVERA_LINKS } from "@/lib/monveraToken";
import { toWalletEvents, eventLabel, type WalletEvent } from "@/lib/walletActivity";
import { shortAddress, relTime, fmtAmt, tokenQty, txUrl, addressUrl } from "@/lib/format";

// ── shared bits ──────────────────────────────────────────────────────────────

/** Plain glass card (background FIRST so the serialized style contains "var(--panel);"). */
const card = (radius: number, extra?: CSSProperties): CSSProperties => ({
  background: "var(--panel)", border: "1px solid var(--line)", borderRadius: radius, ...extra,
});

/** Hero card — primary-tinted gradient layered over the glass panel. */
const hero = (mixPct: number, radius: number, extra?: CSSProperties): CSSProperties => ({
  background: `linear-gradient(135deg,color-mix(in srgb,var(--primary) ${mixPct}%,transparent),transparent 62%),var(--panel)`,
  border: "1px solid var(--line)", borderRadius: radius, padding: 20, ...extra,
});

function Pill({ text, bg = "var(--primary-soft)", fg = "var(--primary)" }: { text: string; bg?: string; fg?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, background: bg, color: fg, fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />{text}
    </span>
  );
}

// Naked stat pair — the tiny caps label is the structure, no box needed.
function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "8px 4px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: color ?? "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function CheckRow({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderTop: "1px solid var(--line-2)" }}>
      <span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--primary-soft)", color: "var(--primary)", display: "grid", placeItems: "center", flex: "none" }}><PIcon name={icon} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{sub}</div>
      </div>
      <PIcon name="ph-check-circle" size={16} weight="fill" style={{ color: "var(--pos)" }} />
    </div>
  );
}

const EMPTY_NOTE: CSSProperties = { padding: "26px 16px", textAlign: "center", color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.5 };

/** Compact $ figure for token/market-cap style stats. */
function bigUsd(n?: number | null): string {
  if (n === undefined || n === null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return usd(n);
}

/** Compact plain number (share volume etc.). */
function bigNum(n?: number | null): string {
  if (n === undefined || n === null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(Math.round(n));
}

/** "$18.4k" style figure for the Vera invested stat. */
function kUsd(n: number): string {
  return n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : usd0(n);
}

/** riskScore is basis points (0–10000): <2500 Steady, <5000 Balanced, <7500 Bold, else Spicy. */
function riskMeta(bps: number): { label: string; tone: string } {
  if (bps < 2500) return { label: "Steady", tone: "var(--pos)" };
  if (bps < 5000) return { label: "Balanced", tone: "var(--primary)" };
  if (bps < 7500) return { label: "Bold", tone: "var(--primary-2)" };
  return { label: "Spicy", tone: "var(--neg)" };
}

/** USDG in/out over the last 30 days from wallet events. */
function monthFlows(events: WalletEvent[]): { inUsd: number; outUsd: number; any: boolean } {
  const cutoff = Date.now() / 1000 - 30 * 86400;
  let inUsd = 0, outUsd = 0, any = false;
  for (const e of events) {
    if (!e.timestamp || e.timestamp < cutoff) continue;
    if (e.kind === "receive" && e.symbol === "USDG") { inUsd += e.amount; any = true; }
    else if (e.kind === "sell") { inUsd += e.usdgAmount ?? 0; any = true; }
    else if (e.kind === "send" && e.symbol === "USDG") { outUsd += e.amount; any = true; }
    else if (e.kind === "buy") { outUsd += e.usdgAmount ?? 0; any = true; }
  }
  return { inUsd, outUsd, any };
}

/** Row copy for one wallet event (title/sub/right amount + its color). */
function eventBits(e: WalletEvent): { title: string; sub: string; right: string; color: string } {
  const { verb, positive } = eventLabel(e);
  const isTrade = e.kind === "buy" || e.kind === "sell";
  const name = e.symbol === "USDG" ? "cash" : displayFor(e.symbol).name;
  const via = isTrade ? "Swap" : e.counterparty ? (positive ? "From " : "To ") + shortAddress(e.counterparty) : "Transfer";
  return {
    title: `${verb} ${name}`,
    sub: via + (e.timestamp ? " · " + relTime(e.timestamp) : ""),
    right: isTrade ? (e.kind === "buy" ? "−" : "+") + usd(e.usdgAmount ?? 0) : (positive ? "+" : "−") + fmtAmt(e.amount) + " " + e.symbol,
    color: (isTrade ? e.kind === "sell" : positive) ? "var(--pos)" : "var(--ink)",
  };
}

// ── market ───────────────────────────────────────────────────────────────────

const MARKET_PAGE = 15;

function MarketPanel({ nav }: { nav: ChatNav }) {
  const { data: prices } = usePrices();
  const { data: market } = useMarketSummary();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [pages, setPages] = useState(1);
  const watchedList = useWatchlist();
  // Two-way liquidity gate: names without a live buy AND sell route stay
  // VISIBLE but locked ("Soon") — no buy control, list demoted below the
  // tradable names. null = sweep unknown — fail open, lock nothing.
  const { data: trad } = useTradability();
  const twoWay = trad?.ok ? new Set(trad.ok) : null;
  const isLocked = (a: (typeof ALL_ASSETS)[number]) =>
    twoWay !== null && (a.tier === "stock" || a.tier === "etf") && !twoWay.has(a.symbol);

  const cats = useMemo(() => {
    const seen = new Set<string>();
    for (const a of ALL_ASSETS) seen.add(catFor(a.symbol, a.name));
    return ["All", "\u2605 Watchlist", ...["Tech", "Consumer", "Finance", "Energy", "Funds"].filter((c) => seen.has(c))];
  }, []);

  const needle = q.trim().toLowerCase();
  const all = ALL_ASSETS.filter((a) => {
    const d = displayFor(a.symbol, a.name);
    // Shared matcher: symbol/name/category PLUS ~27 theme keys ("ai" finds the
    // AI names) — the one the desktop market and server already use.
    const okQ = needle === "" || matchesSearch(a.symbol, d.name, d.cat, needle);
    const okCat = cat === "All" || (cat === "\u2605 Watchlist" ? watchedList.includes(a.symbol) : d.cat === cat);
    return okQ && okCat;
  }).sort((x, y) => Number(isLocked(x)) - Number(isLocked(y)));
  // True pages (Prev/Next swap the list); search or category change resets to page 1.
  const totalPages = Math.max(1, Math.ceil(all.length / MARKET_PAGE));
  const page = Math.min(pages, totalPages); // 1-based, clamped when the filter shrinks
  const rows = all.slice((page - 1) * MARKET_PAGE, page * MARKET_PAGE);

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", display: "grid" }}><PIcon name="ph-magnifying-glass" size={16} /></span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPages(1); }} placeholder="Search stocks & funds…" aria-label="Search market" style={{ height: 42, width: "100%", padding: "0 14px 0 38px", borderRadius: 13, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
      </div>

      {/* one straight line — scrolls sideways instead of wrapping */}
      <div className="nosb" style={{ display: "flex", gap: 7, marginBottom: 12, flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch", paddingBottom: 2 }}>
        {cats.map((c) => {
          const on = c === cat;
          return (
            <button key={c} onClick={() => { setCat(c); setPages(1); }} style={{ height: 32, padding: "0 14px", flex: "none", whiteSpace: "nowrap", border: "1px solid " + (on ? "var(--primary)" : "var(--line)"), borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: on ? "var(--primary)" : "var(--panel-2)", color: on ? "var(--primary-ink)" : "var(--ink-2)" }}>{c}</button>
          );
        })}
      </div>

      {rows.map((a) => {
        const d = displayFor(a.symbol, a.name);
        const tile = toTile(a.symbol, a.name);
        const live = market?.summary[a.symbol];
        const livePrice = prices?.prices[a.symbol]?.priceUsd;
        const sparkLast = live?.spark?.length ? live.spark[live.spark.length - 1] : undefined;
        const price = livePrice ?? sparkLast ?? d.price;
        const day = live?.dayChangePct ?? d.day;
        const spark = live?.spark ?? tile.spark;
        const locked = isLocked(a);
        const muted = d.coming || locked || (!live && livePrice === undefined);
        return (
          <div key={a.symbol} className="hgl" style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 14 }}>
            <button onClick={() => nav.openCanvas("holding", a.symbol)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11, textAlign: "left" }}>
              <AssetTile asset={tile} size={38} radius={12} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>{d.name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{a.symbol} · {d.cat}</span>
              </span>
              <svg viewBox="0 0 74 26" width={58} height={22} style={{ display: "block", flex: "none" }} aria-hidden>
                <path d={sparkPath(spark)} fill="none" stroke={muted ? "var(--ink-3)" : dcol(day)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ textAlign: "right", flex: "none", minWidth: 70 }}>
                <span className="tnum" style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{d.coming ? "Soon" : price !== undefined ? priceStr(price) : "—"}</span>
                <span className="tnum" style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: muted ? "var(--ink-3)" : dcol(day) }}>{muted ? "—" : pctStr(day)}</span>
              </span>
            </button>
            <button onClick={() => toggleWatch(a.symbol)} aria-label="Watchlist" style={{ width: 30, height: 30, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: "transparent", color: watchedList.includes(a.symbol) ? "var(--primary)" : "var(--ink-3)" }}>
              <PIcon name="ph-star" size={15} weight={watchedList.includes(a.symbol) ? "fill" : "duotone"} />
            </button>
            {locked ? (
              <span style={{ height: 26, padding: "0 11px", borderRadius: 999, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", border: "1px solid var(--line)", display: "inline-flex", alignItems: "center", gap: 5, flex: "none" }}>
                <PIcon name="ph-lock-simple" size={11} /> Soon
              </span>
            ) : !d.coming && (
              <button onClick={() => nav.openBuy(a.symbol)} style={{ height: 32, padding: "0 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: "var(--primary)", background: "var(--primary-soft)", flex: "none" }}>Buy</button>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <div style={EMPTY_NOTE}>Nothing matches that search.</div>}
      {twoWay !== null && trad!.dropped.length > 0 && (
        <p style={{ margin: "10px 4px 0", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
          Locked names are coming soon — no two-way trading route at the venues yet. They unlock automatically when liquidity arrives.
        </p>
      )}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button onClick={() => setPages(page - 1)} disabled={page <= 1} aria-label="Previous page" style={{ flex: 1, height: 42, borderRadius: 13, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink-2)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: page <= 1 ? 0.45 : 1 }}>
            <PIcon name="ph-caret-left" size={13} weight="bold" /> Prev
          </button>
          <span className="tnum" style={{ flex: "none", fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPages(page + 1)} disabled={page >= totalPages} aria-label="Next page" style={{ flex: 1, height: 42, borderRadius: 13, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink-2)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: page >= totalPages ? 0.45 : 1 }}>
            Next <PIcon name="ph-caret-right" size={13} weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── holding (asset detail) ───────────────────────────────────────────────────

const RANGES: MarketRange[] = ["1D", "1W", "1M", "1Y", "All"];
const RANGE_LABEL: Record<MarketRange, string> = { "1D": "Today", "1W": "Past week", "1M": "Past month", "1Y": "Past year", All: "All time" };
// Fallback curve params per range (design's AR table) — used only while the real
// series loads / when an asset has no live source.
const RANGE_CURVE: Record<MarketRange, [number, number, number, number]> = {
  "1D": [1.1, 26, 0.05, 0.7], "1W": [0.7, 30, 0.09, 1], "1M": [0.4, 40, 0.18, 1.6], "1Y": [0.28, 52, 0.3, 2.2], All: [0.2, 60, 0.4, 2.8],
};

function HoldingPanel({ symbol, nav }: { symbol: string; nav: ChatNav }) {
  const d = displayFor(symbol);
  const tile = toTile(symbol);
  const [range, setRange] = useState<MarketRange>("1M");
  const { data: prices } = usePrices();
  const { data: market } = useMarketSummary();
  const { data: hist } = useMarketHistory(symbol, range);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);

  const live = market?.summary[symbol];
  const sparkLast = live?.spark?.length ? live.spark[live.spark.length - 1] : undefined;
  const price = prices?.prices[symbol]?.priceUsd ?? sparkLast ?? d.price;
  const day = live?.dayChangePct ?? d.day;
  const up = day >= 0;
  const series = hist?.series && hist.series.length > 1 ? hist.series : null;
  const cp = RANGE_CURVE[range];
  const paths = chartPaths(series ?? curve(cp[0], cp[1], up ? cp[2] : -cp[2] * 0.7, cp[3]), 400, 210);
  const color2 = up ? "var(--pos)" : "var(--neg)";

  const holding = (port?.holdings ?? []).find((h) => h.asset.symbol === symbol);
  // Two-way liquidity lock — same rule as the market list and the order ticket.
  const { data: trad } = useTradability();
  const lockedSoon = trad?.ok != null && !trad.ok.includes(symbol);
  const watched = useIsWatched(symbol);
  const { createAlert } = useNotifyActions();
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertDir, setAlertDir] = useState<"above" | "below">("above");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertState, setAlertState] = useState<"idle" | "saving" | "set">("idle");
  const held = !!holding && holding.qty > 0;
  const positionStr = holding ? (holding.valueUsd !== undefined ? usd(holding.valueUsd) : fmtAmt(holding.qty) + " sh") : "";

  const meta = hist?.meta;
  // Context the old asset page had: why it moved today (relative to the tape),
  // and the stock's move since the user's first buy. Caveats kept verbatim;
  // they're what makes these claims safe with no cost basis tracked.
  const { data: ctxTxs } = useTransactions(address ?? undefined);
  const moved = whyItMoved(symbol, market?.summary);
  const entryTs = held
    ? (ctxTxs ?? []).filter((t) => t.symbol === symbol && t.direction === "in").reduce<number | undefined>((min, t) => (t.timestamp && (!min || t.timestamp < min) ? t.timestamp : min), undefined)
    : undefined;
  const { data: yearHist } = useMarketHistory(symbol, "1Y");
  const since = held ? sinceBought(entryTs, yearHist?.timestamps, yearHist?.series, price) : null;
  const stats: { label: string; value: string }[] = [
    { label: "Open", value: series ? usd(series[0]) : "—" },
    { label: "Day high", value: meta?.dayHigh !== undefined ? usd(meta.dayHigh) : series ? usd(Math.max(...series)) : "—" },
    { label: "Day low", value: meta?.dayLow !== undefined ? usd(meta.dayLow) : series ? usd(Math.min(...series)) : "—" },
    { label: "52w high", value: meta?.fiftyTwoWeekHigh !== undefined ? usd(meta.fiftyTwoWeekHigh) : "—" },
    { label: "52w low", value: meta?.fiftyTwoWeekLow !== undefined ? usd(meta.fiftyTwoWeekLow) : "—" },
    { label: "Volume", value: bigNum(meta?.volume) },
  ];

  return (
    <div>
      {/* identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <AssetTile asset={tile} size={50} radius={15} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="serif" style={{ fontSize: 22, fontWeight: 500 }}>{d.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{symbol} · {d.cat}</div>
        </div>
        {/* watchlist star — synced cross-device via /api/watchlist */}
        <button onClick={() => toggleWatch(symbol)} aria-label={watched ? "Remove from watchlist" : "Add to watchlist"} style={{ width: 38, height: 38, flex: "none", borderRadius: 12, display: "grid", placeItems: "center", border: "1px solid var(--line)", background: watched ? "var(--primary-soft)" : "transparent", color: watched ? "var(--primary)" : "var(--ink-3)" }}>
          <PIcon name="ph-star" size={18} weight={watched ? "fill" : "duotone"} />
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
        <span className="serif tnum" style={{ fontSize: 30, fontWeight: 500 }}>{price !== undefined ? priceStr(price) : "—"}</span>
        {live && <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: dcol(day) }}>{pctStr(day)} today</span>}
      </div>

      {/* chart */}
      <div style={card(16, { marginTop: 12, padding: 14 })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)" }}>{RANGE_LABEL[range]}</span>
          <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 10, padding: 3, gap: 2 }}>
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{ height: 26, padding: "0 11px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, background: r === range ? "var(--bg)" : "transparent", boxShadow: r === range ? "0 1px 4px rgba(12,32,20,.14)" : "none", color: r === range ? "var(--primary)" : "var(--ink-3)" }}>{r}</button>
            ))}
          </div>
        </div>
        <ChartHover series={series} vh={210} fmt={usd} color={color2}>
          <svg viewBox="0 0 400 210" preserveAspectRatio="none" width="100%" height={210} style={{ display: "block" }} aria-hidden>
            <defs>
              <linearGradient id="mvcAssetGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color2} stopOpacity={0.26} />
                <stop offset="100%" stopColor={color2} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={paths.area} fill="url(#mvcAssetGrad)" />
            <path d={paths.line} fill="none" stroke={color2} strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ChartHover>
      </div>

      {/* position — naked row framed by hairlines */}
      {held && (
        <div style={{ marginTop: 14, padding: "12px 4px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--ink-3)" }}>You own</div>
            <div className="tnum serif" style={{ fontSize: 22, fontWeight: 500, marginTop: 2 }}>{positionStr}</div>
          </div>
          <PIcon name="ph-trend-up" size={24} style={{ color: "var(--pos)" }} />
        </div>
      )}

      {/* about + stats — naked prose on the rail */}
      <div style={{ marginTop: 16, padding: "0 4px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>About {d.name}</div>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{d.desc}</p>
      </div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
        {stats.map((st) => <StatTile key={st.label} label={st.label} value={st.value} />)}
      </div>

      {/* actions — a name without a two-way venue route is locked whole:
          no buy, no sell, one honest bar instead of two dead buttons */}
      {lockedSoon ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 14, fontSize: 13.5, fontWeight: 600, color: "var(--ink-3)", background: "var(--panel-2)", border: "1px dashed var(--line)" }}>
            <PIcon name="ph-lock-simple" size={15} /> Coming soon
          </div>
          <p style={{ margin: "8px 2px 0", fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-3)", textAlign: "center" }}>
            The venues can&rsquo;t trade this one both ways yet. It unlocks automatically when liquidity arrives{held ? " — your position stays safe in your wallet" : ""}.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => nav.openBuy(symbol)} disabled={d.coming} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 48, borderRadius: 14, fontSize: 14.5, fontWeight: 600, color: "var(--primary-ink)", background: "var(--primary)", opacity: d.coming ? 0.5 : 1 }}>
            <PIcon name="ph-plus" size={16} weight="bold" /> {d.coming ? "Coming soon" : "Buy"}
          </button>
          {held && (
            <button onClick={() => nav.openSell(symbol)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 48, borderRadius: 14, fontSize: 14.5, fontWeight: 600, color: "var(--ink)", background: "var(--panel-2)", border: "1px solid var(--line)" }}>
              <PIcon name="ph-minus" size={16} weight="bold" /> Sell
            </button>
          )}
        </div>
      )}

      {/* context: why it moved · since you bought · where it sits in the year */}
      {(moved || since || (meta?.fiftyTwoWeekLow !== undefined && meta?.fiftyTwoWeekHigh !== undefined && price)) && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {moved && (
            <div style={{ padding: "10px 13px", borderRadius: 13, background: "color-mix(in srgb, var(--primary) 7%, transparent)", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {moved.text}
            </div>
          )}
          {since && (
            <div style={{ padding: "10px 13px", borderRadius: 13, background: "var(--panel-2)", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Since your first buy ({new Date(since.entryTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}), {tile.name} is {since.up ? "up" : "down"} {Math.abs(since.pct).toFixed(1)}%. That&apos;s the stock&apos;s move, not your gain.
            </div>
          )}
          {meta?.fiftyTwoWeekLow !== undefined && meta?.fiftyTwoWeekHigh !== undefined && price && meta.fiftyTwoWeekHigh > meta.fiftyTwoWeekLow && (
            <div style={{ padding: "10px 13px", borderRadius: 13, background: "var(--panel-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-3)", marginBottom: 6 }}>
                <span>52w low {usd(meta.fiftyTwoWeekLow)}</span><span>52w high {usd(meta.fiftyTwoWeekHigh)}</span>
              </div>
              <div style={{ position: "relative", height: 4, borderRadius: 99, background: "var(--line)" }}>
                <span style={{ position: "absolute", top: -3, width: 10, height: 10, borderRadius: "50%", background: "var(--primary)", boxShadow: "0 0 0 2px var(--panel-2)", left: `calc(${Math.max(0, Math.min(100, ((price - meta.fiftyTwoWeekLow) / (meta.fiftyTwoWeekHigh - meta.fiftyTwoWeekLow)) * 100)).toFixed(1)}% - 5px)` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* price alert — classic Notification Center parity */}
      <div style={{ marginTop: 10 }}>
        {alertState === "set" ? (
          <button onClick={() => nav.openCanvas("alerts")} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 7, height: 42, borderRadius: 13, border: "1px solid var(--line)", background: "transparent", color: "var(--primary)", fontSize: 13, fontWeight: 600 }}>
            <PIcon name="ph-check-circle" size={15} weight="fill" /> Alert set — view all alerts
          </button>
        ) : !alertOpen ? (
          <button onClick={() => { setAlertPrice(price !== undefined ? String(Number(price.toFixed(price < 1 ? 4 : 2))) : ""); setAlertOpen(true); }} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 7, height: 42, borderRadius: 13, border: "1px solid var(--line)", background: "transparent", color: "var(--ink-2)", fontSize: 13, fontWeight: 600 }}>
            <PIcon name="ph-bell" size={15} /> Alert me at a price
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 999, padding: 3, gap: 2, flex: "none" }}>
              {(["above", "below"] as const).map((dir) => (
                <button key={dir} onClick={() => setAlertDir(dir)} style={{ height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: alertDir === dir ? "var(--bg)" : "transparent", boxShadow: alertDir === dir ? "0 1px 4px rgba(12,32,20,.14)" : "none", color: alertDir === dir ? "var(--primary)" : "var(--ink-3)" }}>{dir === "above" ? "≥" : "≤"}</button>
              ))}
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "6px 11px", minWidth: 0 }}>
              <span className="tnum" style={{ fontSize: 14, color: "var(--ink-3)" }}>$</span>
              <input value={alertPrice} onChange={(e) => setAlertPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Alert price" className="tnum" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 14, fontWeight: 600, minWidth: 0 }} />
            </div>
            <button
              onClick={async () => {
                const t = parseFloat(alertPrice);
                if (!isFinite(t) || t <= 0 || alertState === "saving") return;
                setAlertState("saving");
                try { await createAlert({ symbol, direction: alertDir, threshold: t }); setAlertState("set"); setAlertOpen(false); }
                catch { setAlertState("idle"); }
              }}
              style={{ height: 40, padding: "0 15px", flex: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", opacity: alertState === "saving" ? 0.6 : 1 }}
            >
              {alertState === "saving" ? "…" : "Set"}
            </button>
          </div>
        )}
      </div>
      <button onClick={() => nav.askVera(`Add ${d.name} to a diversified plan`)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8, height: 44, marginTop: 9, borderRadius: 14, fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)", background: "none", border: "1px dashed var(--line)" }}>
        <PIcon name="ph-sparkle" size={15} weight="fill" style={{ color: "var(--primary)" }} /> Ask Vera to add this to a plan
      </button>
    </div>
  );
}

// ── portfolio ────────────────────────────────────────────────────────────────

function PortfolioPanel({ nav }: { nav: ChatNav }) {
  const { address } = useSmartAccount();
  const hiddenP = useHidden();
  const { data: port, isLoading } = usePortfolio(address ?? undefined);

  const cash = port?.cashUsd ?? 0;
  const total = port?.totalUsd ?? 0;
  const monveraValue = (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA")?.valueUsd ?? 0;
  const invested = Math.max(0, (port?.investedUsd ?? 0) - monveraValue);

  const holdings = (port?.holdings ?? [])
    .filter((h) => h.asset.symbol !== "MONVERA")
    .slice()
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const stockValue = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  const dayUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0) * ((h.dayChangePct ?? 0) / 100), 0);
  const dayStr = (dayUsd >= 0 ? "+" : "−") + "$" + Math.abs(dayUsd).toFixed(2);

  // Donut ring over non-MONVERA holdings by valueUsd share.
  const segs = holdings.filter((h) => (h.valueUsd ?? 0) > 0);
  let acc = 0;
  const stops: string[] = [];
  const legend = segs.map((h, i) => {
    const w = stockValue > 0 ? ((h.valueUsd ?? 0) / stockValue) * 100 : 0;
    const col = `color-mix(in srgb, var(--primary) ${Math.max(28, 92 - i * 15)}%, var(--panel-2))`;
    stops.push(`${col} ${acc.toFixed(1)}% ${(acc + w).toFixed(1)}%`);
    acc += w;
    return { sym: h.asset.symbol, name: toTile(h.asset.symbol, h.asset.name).name, col, weight: Math.round(w) + "%" };
  });
  const donutGrad = stops.length ? `conic-gradient(${stops.join(",")})` : "var(--panel-2)";
  const topWeight = legend.length ? legend[0].weight : "";

  return (
    <div>
      {/* hero */}
      <div style={hero(15, 20, { padding: "20px 22px" })}>
        <div style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)" }}>Total balance</div>
        <div className="serif tnum" style={{ fontSize: 34, fontWeight: 500, marginTop: 2 }}>{money(total, hiddenP)}</div>
        <div className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: dcol(dayUsd), marginTop: 2 }}>{dayStr} today</div>
        <div style={{ display: "flex", gap: 20, marginTop: 14, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Cash</div>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{usd(cash)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Invested</div>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{usd(invested)}</div>
          </div>
          {stockValue > 0 && (
            <button onClick={() => nav.askVera("Sell everything")} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 13px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 12, fontWeight: 650, color: "var(--ink-2)" }}>
              <PIcon name="ph-hand-coins" size={14} weight="bold" style={{ color: "var(--neg)" }} /> Cash out
            </button>
          )}
        </div>
      </div>

      {/* donut + legend — naked on the rail */}
      {segs.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18, padding: "0 4px" }}>
          <div style={{ position: "relative", width: 104, height: 104, flex: "none" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: donutGrad }} />
            <div style={{ position: "absolute", inset: 15, borderRadius: "50%", background: "var(--bg)", display: "grid", placeItems: "center", textAlign: "center" }}>
              <div>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>{holdings.length}</div>
                <div style={{ fontSize: 9.5, color: "var(--ink-3)" }}>holdings</div>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
            {legend.slice(0, 6).map((l) => (
              <div key={l.sym} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: l.col }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-2)" }}>{l.name}</span>
                <span className="tnum" style={{ fontWeight: 600 }}>{l.weight}</span>
              </div>
            ))}
            {legend.length > 6 && <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>+{legend.length - 6} more</div>}
          </div>
        </div>
      )}

      {/* holdings — naked hairline list */}
      <div style={{ marginTop: 14, padding: "0 2px" }}>
        {holdings.length === 0 && (
          <div style={EMPTY_NOTE}>{isLoading ? "Loading your holdings…" : "You don't own anything yet — start a plan with Vera to get going."}</div>
        )}
        {holdings.map((h, i) => {
          const tile = toTile(h.asset.symbol, h.asset.name);
          const w = stockValue > 0 && h.valueUsd !== undefined ? Math.round((h.valueUsd / stockValue) * 100) + "% of portfolio" : "";
          return (
            <div key={h.asset.symbol} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 6px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
              <button onClick={() => nav.openCanvas("holding", h.asset.symbol)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
                <AssetTile asset={tile} size={34} radius={10} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{tile.name}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{h.valueUsd !== undefined ? usd(h.valueUsd) : "—"}{w ? " · " + w : ""}</span>
                </span>
              </button>
              <button onClick={() => nav.openBuy(h.asset.symbol)} title="Buy more" style={{ width: 30, height: 30, flex: "none", border: "1px solid var(--line)", borderRadius: 9, display: "grid", placeItems: "center", background: "transparent", color: "var(--primary)" }}><PIcon name="ph-plus" size={13} weight="bold" /></button>
              <button onClick={() => nav.openSell(h.asset.symbol)} title="Sell" style={{ width: 30, height: 30, flex: "none", border: "1px solid var(--line)", borderRadius: 9, display: "grid", placeItems: "center", background: "transparent", color: "var(--neg)" }}><PIcon name="ph-minus" size={13} weight="bold" /></button>
            </div>
          );
        })}
      </div>

      {/* stats */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        <StatTile label="Today" value={dayStr} color={dcol(dayUsd)} />
        <StatTile label="Top holding" value={legend.length ? `${legend[0].name} · ${topWeight}` : "—"} />
        <StatTile label="Cash ready" value={usd(cash)} />
      </div>

      <VeraRead holdings={holdings.map((h) => ({ symbol: h.asset.symbol, weightPct: Math.max(0.01, h.valueUsd ?? 0) }))} />

      <button onClick={() => nav.askVera("Review my portfolio and rebalance if needed")} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8, height: 50, marginTop: 10, borderRadius: 14, fontSize: 15, fontWeight: 600, color: "var(--primary-ink)", background: "var(--primary)" }}>
        <PIcon name="ph-sparkle" size={17} weight="fill" /> Ask Vera to rebalance
      </button>
    </div>
  );
}

// ── vera (track record) ──────────────────────────────────────────────────────

function VeraPanel() {
  const { data: record } = useVeraRecord();
  const { data: identity } = useAgentIdentity();
  const recents = record?.recentRecommendations ?? [];
  const plansBuilt = record?.totalRecommendations ?? 0;
  const onchain = record?.executedCount ?? 0;

  return (
    <div>
      {/* hero */}
      <div style={hero(20, 22)}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ position: "relative", width: 88, height: 88, flex: "none" }}>
            <svg viewBox="0 0 88 88" width={88} height={88} style={{ display: "block", transform: "rotate(-90deg)" }} aria-hidden>
              <circle cx={44} cy={44} r={39} fill="none" stroke="var(--panel-2)" strokeWidth={7} />
              <circle cx={44} cy={44} r={39} fill="none" stroke="var(--primary)" strokeWidth={7} strokeLinecap="round" strokeDasharray="194 245" />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><PIcon name="ph-seal-check" size={30} style={{ color: "var(--primary)" }} /></div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Pill text={`Agent №${String(identity?.agentId ?? 1)} · ERC-8004`} />
            <div className="serif" style={{ fontSize: 23, fontWeight: 500, marginTop: 7, letterSpacing: "-.01em" }}>Every move, signed.</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{plansBuilt} plans built · {onchain} placed on-chain · nothing hidden</div>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: "var(--panel-2)" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)" }}>Signer</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--primary)" }}>{identity?.signer ? shortAddress(identity.signer) : "—"}</span>
        </div>
      </div>

      {/* stats */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        {([
          { label: "Plans built", value: String(plansBuilt) },
          { label: "Invested", value: kUsd(record?.totalExecutedUsd ?? 0), color: "var(--pos)" },
          { label: "On-chain", value: String(onchain) },
        ] as { label: string; value: string; color?: string }[]).map((st) => (
          <div key={st.label} style={{ padding: "8px 4px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>{st.label}</div>
            <div className="tnum serif" style={{ fontSize: 18, fontWeight: 500, marginTop: 2, color: st.color ?? "var(--ink)" }}>{st.value}</div>
          </div>
        ))}
      </div>

      {/* track record timeline — naked section */}
      <div style={{ marginTop: 16, padding: "0 4px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Track record</div>
        {recents.length === 0 && <div style={{ ...EMPTY_NOTE, paddingTop: 4 }}>No recorded plans yet — every plan Vera signs will appear here.</div>}
        {recents.map((r) => {
          const placed = r.usdcSpent !== undefined;
          const { label, tone } = riskMeta(r.riskScore);
          return (
            <div key={r.planId} style={{ display: "flex", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none", width: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", flex: "none", background: tone, marginTop: 4 }} />
                <span style={{ flex: 1, width: 2, background: "var(--line-2)", marginTop: 4 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 16 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{label} plan</span>
                <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{placed ? usd0(r.usdcSpent as number) : "—"}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: placed ? "var(--pos)" : "var(--ink-3)", minWidth: 74, textAlign: "right" }}>{placed ? "Invested" : "Recommended"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* checklist — naked section */}
      <div style={{ marginTop: 16, padding: "0 4px" }}>
        <div style={{ padding: "0 0 6px", fontSize: 13.5, fontWeight: 700 }}>Before any money moves</div>
        <CheckRow icon="ph-signature" title="Plan signed by Vera" sub="Every recommendation carries her signature" />
        <CheckRow icon="ph-seal-check" title="Verified on-chain" sub="ERC-8004 identity, checked before placing" />
        <CheckRow icon="ph-lock-key" title="Placed from your wallet" sub="Self-custody, gasless — keys stay yours" />
      </div>
    </div>
  );
}

// ── wallet ───────────────────────────────────────────────────────────────────

function WalletPanel({ nav }: { nav: ChatNav }) {
  const { address } = useSmartAccount();
  const recover = useLegacyRecover();
  const hidden = useHidden();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: txs } = useTransactions(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const cash = bal?.value ?? 0;
  const events = useMemo(() => toWalletEvents(txs ?? []), [txs]);
  const flows = monthFlows(events);
  // Everything the account holds: MONVERA first (the project token), then stocks by value.
  const held = useMemo(
    () =>
      (port?.holdings ?? [])
        .filter((h) => (h.valueUsd ?? h.settlingUsd ?? 0) > 0 || h.qty > 0)
        .slice()
        .sort((a, b) => (a.asset.symbol === "MONVERA" ? -1 : b.asset.symbol === "MONVERA" ? 1 : (b.valueUsd ?? 0) - (a.valueUsd ?? 0))),
    [port],
  );

  return (
    <div>
      {/* hero */}
      <div style={hero(20, 22)}>
        <Pill text="Self-custody · Gasless" />
        {(() => {
          // The wallet is the money hub — the headline is EVERYTHING the account
          // holds (cash + stocks + $MONVERA + settling fills), not just USDG.
          const total = Math.max(port?.totalUsd ?? 0, cash);
          const investedAll = Math.max(0, total - cash);
          return (
            <>
              <div className="serif tnum" style={{ fontSize: 34, fontWeight: 500, marginTop: 8, letterSpacing: "-.01em" }}>{money(total, hidden)}</div>
              <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
                {money(cash, hidden)} cash · {money(investedAll, hidden)} in stocks & tokens
              </div>
            </>
          );
        })()}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: "var(--panel-2)" }}>
          {/* the self-custody claim, checkable: the address links to the explorer */}
          {address ? (
            <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
              {shortAddress(address)} <PIcon name="ph-arrow-square-out" size={11} weight="bold" style={{ color: "var(--primary)" }} />
            </a>
          ) : (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>…</span>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "var(--primary)" }}>
            <PIcon name="ph-lock-key" size={13} weight="fill" /> only you hold the keys
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => nav.openReceive()} style={{ flex: 1, height: 44, borderRadius: 999, fontSize: 13.5, fontWeight: 600, background: "var(--primary)", color: "var(--primary-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <PIcon name="ph-qr-code" size={16} /> Receive
          </button>
          <button onClick={() => nav.openSend()} style={{ flex: 1, height: 44, borderRadius: 999, fontSize: 13.5, fontWeight: 600, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <PIcon name="ph-paper-plane-tilt" size={15} /> Send
          </button>
        </div>
      </div>

      {/* stranded USDG at the previous account address: real money, one tap back */}
      {recover.hasFunds && (
        <div style={{ marginTop: 12, padding: "13px 14px", borderRadius: 16, border: "1.5px solid var(--primary)", background: "var(--primary-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700 }}>
            <PIcon name="ph-info" size={16} weight="bold" style={{ color: "var(--primary)" }} /> Recover previous balance
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 5 }}>
            You have <b className="tnum" style={{ color: "var(--ink)" }}>{usd(recover.usdValue)}</b> at your previous account address. Move it here, gas on us.
          </div>
          {recover.error && <div style={{ fontSize: 12, color: "var(--neg)", marginTop: 5 }}>{recover.error}</div>}
          <button onClick={() => recover.recover()} disabled={recover.phase === "moving"} style={{ width: "100%", height: 42, marginTop: 9, borderRadius: 12, fontSize: 13, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", opacity: recover.phase === "moving" ? 0.6 : 1 }}>
            {recover.phase === "moving" ? "Moving…" : `Move ${usd(recover.usdValue)} here`}
          </button>
        </div>
      )}

      {/* in / out */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <StatTile label="In · this month" value={flows.any ? "+" + usd(flows.inUsd) : "—"} color="var(--pos)" />
        <StatTile label="Out · this month" value={flows.any ? "−" + usd(flows.outUsd) : "—"} />
      </div>

      {/* what the account holds — cash, $MONVERA, and every stock */}
      <div style={{ marginTop: 16, padding: "0 2px" }}>
        <div style={{ padding: "0 6px 6px", fontSize: 13.5, fontWeight: 700 }}>Holdings</div>
        <div className="hgl" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 6px", borderRadius: 12 }}>
          <AssetTile asset={toTile("USDG")} size={34} radius={10} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>Cash</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>USDG · always $1</span>
          </span>
          <span className="tnum" style={{ fontWeight: 600, fontSize: 14 }}>{usd(cash)}</span>
        </div>
        {held.map((h) => {
          const sym = h.asset.symbol;
          const tile = toTile(sym, h.asset.name);
          const value = h.valueUsd ?? h.settlingUsd ?? 0;
          return (
            <button key={sym} className="hgl" onClick={() => nav.openCanvas(sym === "MONVERA" ? "token" : "holding", sym)} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "10px 6px", borderTop: "1px solid var(--line-2)", borderRadius: 12, textAlign: "left" }}>
              <AssetTile asset={tile} size={34} radius={10} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.name}</span>
                <span className="tnum" style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{fmtAmt(h.qty)} {sym}{h.settlingUsd ? " · settling" : ""}</span>
              </span>
              <span className="tnum" style={{ fontWeight: 600, fontSize: 14 }}>{value > 0 ? usd(value) : "—"}</span>
            </button>
          );
        })}
        {held.length === 0 && <div style={{ padding: "8px 6px", fontSize: 12.5, color: "var(--ink-2)", borderTop: "1px solid var(--line-2)" }}>No investments yet — cash is all you hold.</div>}
      </div>

      {/* recent activity — naked section */}
      <div style={{ marginTop: 16, padding: "0 2px" }}>
        <div style={{ padding: "0 6px 6px", fontSize: 13.5, fontWeight: 700 }}>Recent activity</div>
        {events.length === 0 && <div style={EMPTY_NOTE}>No activity yet — receive some USDG to get going.</div>}
        {events.slice(0, 6).map((e, i) => {
          const b = eventBits(e);
          return (
            <div key={`${e.hash}-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px" }}>
              <ActivityGlyph event={e} size={34} ring="var(--panel-2)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{b.title}</div>
                <a href={txUrl(e.hash)} target="_blank" rel="noreferrer" className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--ink-3)", textDecoration: "none" }}>{b.sub} <PIcon name="ph-arrow-square-out" size={10} style={{ color: "var(--ink-3)" }} /></a>
              </div>
              <span className="tnum" style={{ fontWeight: 600, fontSize: 13.5, color: b.color }}>{b.right}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── token ($MONVERA) ─────────────────────────────────────────────────────────

function TokenPanel({ nav }: { nav: ChatNav }) {
  const { data: tok } = useMonveraPrice();
  const [tokenRange, setTokenRange] = useState<TokenChartRange>("1d");
  const { data: chart } = useMonveraChart(tokenRange);
  const [caCopied, setCaCopied] = useState(false);
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const monvera = (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA");

  const ch = tok?.change24h;
  const up = (ch ?? 0) >= 0;
  const chartColor = up ? "var(--pos)" : "var(--neg)";
  const series = chart?.series && chart.series.length > 1 ? chart.series : curve(0.35, 44, 0.2, 1.8);
  const paths = chartPaths(series, 640, 110);

  return (
    <div>
      {/* hero */}
      <div style={hero(20, 22)}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 7 }}><ChatMark size={16} />$MONVERA</span>
          <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: dcol(ch ?? 0) }}>{ch !== undefined ? (up ? "▲ " : "▼ ") + Math.abs(ch).toFixed(1) + "% · 24h" : "…"}</span>
        </div>
        <div className="serif tnum" style={{ fontSize: 32, fontWeight: 500, marginTop: 12 }}>{tok ? priceStr(tok.priceUsd) : "…"}</div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, padding: "6px 12px", borderRadius: 999, background: "var(--panel-2)", fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
          <PIcon name="ph-wallet" size={13} weight="fill" style={{ color: "var(--primary)" }} />
          {monvera
            ? <>You hold {tokenQty(monvera.raw, 18)} · ≈ {monvera.valueUsd !== undefined ? usd(monvera.valueUsd) : "—"}</>
            : <>You don&rsquo;t hold any $MONVERA yet</>}
        </div>
        <div style={{ marginTop: 12 }}>
          {/* hover readout only when the series is real history, never the fallback curve */}
          <ChartHover series={chart?.series && chart.series.length > 1 ? chart.series : null} vh={110} fmt={priceStr} color={chartColor}>
            <svg viewBox="0 0 640 110" preserveAspectRatio="none" width="100%" height={84} style={{ display: "block" }} aria-hidden>
              <defs>
                <linearGradient id="mvcTokGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={paths.area} fill="url(#mvcTokGrad)" />
              <path d={paths.line} fill="none" stroke={chartColor} strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ChartHover>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => nav.openBuy("MONVERA")} style={{ flex: 1, height: 44, borderRadius: 999, fontSize: 14, fontWeight: 700, background: "linear-gradient(180deg,var(--primary-2),var(--primary))", border: "1px solid color-mix(in srgb,var(--primary) 70%,#000 8%)", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.25)" }}>Buy</button>
          <button onClick={() => nav.openSell("MONVERA")} style={{ flex: 1, height: 44, borderRadius: 999, fontSize: 14, fontWeight: 600, background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink)" }}>Sell</button>
        </div>
      </div>

      {/* chart ranges — the depth the old token page had */}
      <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "center" }}>
        {(["5m", "1h", "4h", "1d", "7d"] as TokenChartRange[]).map((r) => (
          <button key={r} onClick={() => setTokenRange(r)} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: tokenRange === r ? "var(--primary)" : "var(--panel-2)", color: tokenRange === r ? "var(--primary-ink)" : "var(--ink-3)" }}>{r}</button>
        ))}
      </div>

      {/* stats */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <StatTile label="Mkt cap" value={bigUsd(tok?.marketCap)} />
        <StatTile label="24h volume" value={bigUsd(tok?.volume24h)} />
        <StatTile label="Liquidity" value={bigUsd(tok?.liquidityUsd)} />
        <StatTile label="Supply" value="1B" />
      </div>

      {/* contract address, copyable — plus the places it lives */}
      <button
        onClick={() => { void navigator.clipboard?.writeText(MONVERA.address).then(() => { setCaCopied(true); setTimeout(() => setCaCopied(false), 1600); }); }}
        className="mono"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 10, padding: "10px 13px", borderRadius: 13, background: "var(--panel-2)", fontSize: 11.5, color: "var(--ink-2)", textAlign: "left" }}
      >
        <PIcon name={caCopied ? "ph-check" : "ph-copy"} size={14} weight="bold" style={{ color: "var(--primary)", flex: "none" }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{MONVERA.address}</span>
        <span style={{ flex: "none", fontWeight: 700, fontFamily: "var(--font-ui)" }}>{caCopied ? "Copied" : "Copy CA"}</span>
      </button>
      <div style={{ marginTop: 8, display: "flex", gap: 7 }}>
        {([["Virtuals", MONVERA_LINKS.virtuals], ["GeckoTerminal", MONVERA_LINKS.geckoterminal], ["Blockscout", MONVERA_LINKS.blockscoutToken]] as const).map(([lbl, href]) => (
          <a key={lbl} href={href} target="_blank" rel="noreferrer" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, height: 36, borderRadius: 999, border: "1px solid var(--line)", fontSize: 11.5, fontWeight: 650, color: "var(--ink-2)", textDecoration: "none" }}>
            {lbl} <PIcon name="ph-arrow-square-out" size={11} weight="bold" />
          </a>
        ))}
      </div>

      {/* where revenue goes — the buyback dashboard */}
      <a href="/buyback" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, padding: "12px 13px", borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel)", textDecoration: "none", color: "var(--ink)" }}>
        <PIcon name="ph-arrows-counter-clockwise" size={18} weight="bold" style={{ color: "var(--primary)", flex: "none" }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>Buybacks, live</span>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>Revenue buys $MONVERA on-chain. Every purchase is public.</span>
        </span>
        <PIcon name="ph-caret-right" size={14} weight="bold" style={{ color: "var(--ink-3)" }} />
      </a>

      {/* why hold it — naked section */}
      <div style={{ marginTop: 16, padding: "0 4px" }}>
        <div style={{ padding: "0 0 6px", fontSize: 13.5, fontWeight: 700 }}>Why hold it</div>
        <CheckRow icon="ph-camera" title="Unlocks Scan to Buy" sub="At 100,000 $MONVERA" />
        <CheckRow icon="ph-sparkle" title="Early Vera features" sub="New abilities land for holders first" />
        <CheckRow icon="ph-users-three" title="Community voice" sub="Vote on what Vera learns next" />
      </div>
    </div>
  );
}

// ── autopilot — manual setup, restored from the classic app ──────────────────

function AutopilotPanel({ nav }: { nav: ChatNav }) {
  return (
    <div>
      <AutopilotCanvas nav={nav} />
      <div style={{ marginTop: 16, padding: "0 4px" }}>
        <div style={{ padding: "0 0 6px", fontSize: 13.5, fontWeight: 700 }}>Every run, on its own</div>
        <CheckRow icon="ph-sparkle" title="Builds a fresh plan" sub="That day's prices, your balance of risk" />
        <CheckRow icon="ph-signature" title="Signs it on-chain" sub="ERC-8004 — verifiable before money moves" />
        <CheckRow icon="ph-paper-plane-tilt" title="Places it gasless" sub="Straight from your self-custody wallet" />
      </div>
    </div>
  );
}

// ── scan — real holder gate + real photo→companies flow (ScanCanvas) ─────────

function ScanPanel({ nav }: { nav: ChatNav }) {
  const steps = [
    { icon: "ph-camera", title: "1. Snap it", sub: "Any product, anywhere" },
    { icon: "ph-magnifying-glass", title: "2. Vera digs in", sub: "Finds the companies behind it" },
    { icon: "ph-check-circle", title: "3. One tap", sub: "A plan, placed on-chain" },
  ];
  return (
    <div>
      <ScanCanvas nav={nav} />
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        {steps.map((s) => (
          <div key={s.title} style={{ padding: "15px 6px", textAlign: "center" }}>
            <div style={{ width: 38, height: 38, margin: "0 auto 8px", borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary)", display: "grid", placeItems: "center" }}><PIcon name={s.icon} size={19} /></div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.4 }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Vera's read — the real /api/portfolio-review (concentration, themes, nudges) ──

function VeraRead({ holdings }: { holdings: { symbol: string; weightPct: number }[] }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [review, setReview] = useState<PortfolioReview | null>(null);

  const run = async () => {
    if (state === "loading" || holdings.length === 0) return;
    setState("loading");
    try {
      const res = await fetch("/api/portfolio-review", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ holdings }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setReview((await res.json()) as PortfolioReview);
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (holdings.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      {state === "done" && review ? (
        <div style={{ background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 9%,transparent),transparent 60%),var(--panel)", border: "1px solid var(--line)", borderRadius: 18, padding: "15px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--primary)" }}>
            <PIcon name="ph-sparkle" size={13} weight="fill" /> Vera&rsquo;s read
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 7, lineHeight: 1.45 }}>{review.narrative.verdict}</div>
          {review.narrative.observations.map((o) => (
            <div key={o} style={{ display: "flex", gap: 8, marginTop: 7, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--primary)", flex: "none", marginTop: 6 }} />{o}
            </div>
          ))}
          {review.narrative.nudges.map((n) => (
            <div key={n.title} style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--line-2)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{n.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 1 }}>{n.detail}</div>
            </div>
          ))}
        </div>
      ) : (
        <button onClick={() => void run()} disabled={state === "loading"} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 7, height: 46, borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", fontSize: 14, fontWeight: 600, opacity: state === "loading" ? 0.7 : 1 }}>
          {state === "loading"
            ? <><PIcon name="ph-circle-notch" size={16} weight="bold" style={{ color: "var(--primary)", animation: "mvcspin .8s linear infinite" }} /> Vera is reading your mix…</>
            : <><PIcon name="ph-seal-check" size={16} weight="fill" style={{ color: "var(--primary)" }} /> {state === "error" ? "Couldn't read it — try again" : "Get Vera's read on this mix"}</>}
        </button>
      )}
    </div>
  );
}

// ── activity (full history) ──────────────────────────────────────────────────

const ACTIVITY_PAGE = 10;

function ActivityPanel() {
  const { address } = useSmartAccount();
  const { data: txs } = useTransactions(address ?? undefined);
  const { data: invests } = useActivity(address ?? undefined);
  const events = useMemo(() => toWalletEvents(txs ?? []), [txs]);
  const flows = monthFlows(events);
  const net = flows.inUsd - flows.outUsd;

  // Pagination: page the flat list, then group what's visible.
  const [pages, setPages] = useState(1);
  const visible = events.slice(0, pages * ACTIVITY_PAGE);
  const hasMore = events.length > visible.length;

  const nowSec = Date.now() / 1000;
  const thisWeek = visible.filter((e) => e.timestamp !== undefined && nowSec - e.timestamp <= 7 * 86400);
  const earlier = visible.filter((e) => e.timestamp === undefined || nowSec - e.timestamp > 7 * 86400);
  const groups = [
    { label: "This week", events: thisWeek },
    { label: "Earlier", events: earlier },
  ].filter((g) => g.events.length > 0);

  return (
    <div>
      {/* month summary */}
      <div style={hero(20, 22, { padding: "16px 20px" })}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-3)" }}>This month</div>
        <div style={{ display: "flex", marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--ink-3)" }}>In</div>
            <div className="tnum" style={{ fontSize: 17, fontWeight: 600, marginTop: 2, color: "var(--pos)" }}>{flows.any ? "+" + usd(flows.inUsd) : "—"}</div>
          </div>
          <div style={{ flex: 1, paddingLeft: 16, borderLeft: "1px solid var(--line-2)" }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--ink-3)" }}>Out</div>
            <div className="tnum" style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{flows.any ? "−" + usd(flows.outUsd) : "—"}</div>
          </div>
          <div style={{ flex: 1, paddingLeft: 16, borderLeft: "1px solid var(--line-2)" }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--ink-3)" }}>Net</div>
            <div className="tnum" style={{ fontSize: 17, fontWeight: 600, marginTop: 2, color: "var(--primary)" }}>{flows.any ? (net >= 0 ? "+" : "−") + usd(Math.abs(net)) : "—"}</div>
          </div>
        </div>
      </div>

      {/* Vera's invest receipts — the executor's on-chain AllocationExecuted log */}
      {(invests?.length ?? 0) > 0 && (
        <div style={{ marginTop: 16, padding: "0 4px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-2)", padding: "2px 0 8px" }}>Vera&rsquo;s invests</div>
          {(invests ?? []).slice(0, 6).map((r, i) => (
            <div key={r.txHash} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}><PIcon name="ph-sparkle" size={16} weight="fill" /></span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500 }}>Invested {usd(r.usdc)} across {r.legCount} {r.legCount === 1 ? "stock" : "stocks"}</span>
              <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--ink-3)", textDecoration: "none", flex: "none" }}>
                receipt <PIcon name="ph-arrow-square-out" size={11} />
              </a>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }} />
      {events.length === 0 && (
        <div style={EMPTY_NOTE}>No activity yet — every buy, sell, send, and receive will show up here.</div>
      )}
      {groups.map((g) => (
        <div key={g.label}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-2)", padding: "2px 4px 10px" }}>{g.label}</div>
          {/* naked timeline — the glyph rail is the structure, no box needed */}
          <div style={{ padding: "0 4px", marginBottom: 16 }}>
            {g.events.map((e, i) => {
              const b = eventBits(e);
              return (
                <div key={`${e.hash}-${i}`} style={{ display: "flex", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
                    <ActivityGlyph event={e} size={34} ring="var(--panel-2)" />
                    <span style={{ flex: 1, width: 2, background: "var(--line-2)", marginTop: 4 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "flex-start", gap: 8, paddingBottom: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{b.title}</div>
                      {/* the hash opens the secured record on Blockscout */}
                      <a href={txUrl(e.hash)} target="_blank" rel="noreferrer" className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--ink-3)", marginTop: 1, textDecoration: "none" }}>
                        {b.sub} <PIcon name="ph-arrow-square-out" size={11} style={{ color: "var(--ink-3)" }} />
                      </a>
                    </div>
                    <span className="tnum" style={{ fontWeight: 600, fontSize: 14, color: b.color }}>{b.right}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {hasMore && (
        <button onClick={() => setPages((p) => p + 1)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 7, height: 44, borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 600 }}>
          Show {Math.min(ACTIVITY_PAGE, events.length - visible.length)} more <PIcon name="ph-caret-right" size={13} weight="bold" style={{ transform: "rotate(90deg)" }} />
        </button>
      )}
    </div>
  );
}

// ── insights ─────────────────────────────────────────────────────────────────

function InsightsPanel({ nav }: { nav: ChatNav }) {
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const cash = port?.cashUsd ?? 0;
  const holdings = (port?.holdings ?? []).filter((h) => h.asset.symbol !== "MONVERA");
  const stockValue = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  const techValue = holdings.reduce((s, h) => s + (catFor(h.asset.symbol, h.asset.name) === "Tech" ? (h.valueUsd ?? 0) : 0), 0);
  const techPct = stockValue > 0 ? (techValue / stockValue) * 100 : 0;

  const cards = [
    stockValue > 0
      ? {
          icon: "ph-scales", tint: "var(--primary)", tintBg: "var(--primary-soft)",
          title: techPct >= 35 ? "You lean tech-heavy" : "Your sector mix",
          body: `Around ${Math.round(techPct)}% of your invested money sits in tech names. ${techPct >= 35 ? "A little more in broad funds would smooth the ride." : "Room to lean in — or spread wider with broad funds."}`,
          cta: "Ask Vera to balance it",
          onClick: () => nav.askVera("Rebalance me a bit less tech-heavy"),
        }
      : {
          icon: "ph-scales", tint: "var(--primary)", tintBg: "var(--primary-soft)",
          title: "Start with a plan",
          body: "You don't own anything yet — a first diversified plan spreads your money across real companies from day one.",
          cta: "Build my first plan",
          onClick: () => nav.askVera("Build me a balanced starter plan"),
        },
    {
      icon: "ph-piggy-bank", tint: "var(--pos)", tintBg: "color-mix(in srgb,var(--pos) 14%,transparent)",
      title: "Cash is sitting idle",
      body: `${usd(cash)} in cash isn't earning much. Even a steady fund like SGOV would put it to work.`,
      cta: "Put my cash to work",
      onClick: () => nav.askVera("Put my spare cash to work safely"),
    },
    {
      icon: "ph-repeat", tint: "var(--primary-2)", tintBg: "var(--primary-soft)",
      title: "Invest on autopilot",
      body: "People who invest a little each week tend to stress less about timing. Want me to set that up?",
      cta: "Set up Autopilot",
      onClick: () => nav.openCanvas("autopilot"),
    },
  ];

  // Movers today — only when live day changes exist.
  const withDay = holdings.filter((h) => typeof h.dayChangePct === "number" && (h.valueUsd ?? 0) > 0);
  if (withDay.length >= 2) {
    const best = withDay.reduce((a, b) => ((a.dayChangePct ?? 0) >= (b.dayChangePct ?? 0) ? a : b));
    const worst = withDay.reduce((a, b) => ((a.dayChangePct ?? 0) <= (b.dayChangePct ?? 0) ? a : b));
    if (best.asset.symbol !== worst.asset.symbol) {
      cards.push({
        icon: "ph-chart-line-up", tint: "var(--pos)", tintBg: "color-mix(in srgb,var(--pos) 14%,transparent)",
        title: "Today in your portfolio",
        body: `${displayFor(best.asset.symbol, best.asset.name).name} led (${pctStr(best.dayChangePct ?? 0)}), ${displayFor(worst.asset.symbol, worst.asset.name).name} lagged (${pctStr(worst.dayChangePct ?? 0)}). One day is noise — the mix is what matters.`,
        cta: "See the full portfolio",
        onClick: () => nav.openCanvas("portfolio"),
      });
    }
  }

  // Diversification read.
  if (holdings.length > 0) {
    cards.push(
      holdings.length < 4
        ? {
            icon: "ph-users-three", tint: "var(--primary)", tintBg: "var(--primary-soft)",
            title: "A bit concentrated",
            body: `Everything rides on ${holdings.length} ${holdings.length === 1 ? "name" : "names"} right now. Spreading across more companies smooths the bad days.`,
            cta: "Spread it wider",
            onClick: () => nav.askVera("Diversify my portfolio across more companies"),
          }
        : {
            icon: "ph-users-three", tint: "var(--primary)", tintBg: "var(--primary-soft)",
            title: "Nicely spread",
            body: `You own ${holdings.length} different names — no single company can ruin your week. Keep it that way as you add more.`,
            cta: "Review the mix",
            onClick: () => nav.openCanvas("portfolio"),
          },
    );
  }

  // $MONVERA perk progress (Scan to Buy unlocks at 100k).
  const monQty = (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA")?.qty ?? 0;
  cards.push({
    icon: "ph-camera", tint: "var(--primary-2)", tintBg: "var(--primary-soft)",
    title: monQty >= 100_000 ? "Scan to Buy is unlocked" : "Scan to Buy unlock",
    body:
      monQty >= 100_000
        ? "You hold over 100k $MONVERA — photograph any product and Vera invests in the companies behind it."
        : monQty > 0
          ? `You hold ${Math.round(monQty).toLocaleString("en-US")} $MONVERA — ${Math.round((monQty / 100_000) * 100)}% of the way to unlocking Scan to Buy at 100k.`
          : "Hold 100k $MONVERA to unlock Scan to Buy — photograph any product and Vera invests in the companies behind it.",
    cta: monQty >= 100_000 ? "Open Scan" : "View $MONVERA",
    onClick: () => nav.openCanvas(monQty >= 100_000 ? "scan" : "token"),
  });

  return (
    <div>
      {/* naked insight sections, hairline-separated */}
      {cards.map((c, i) => (
        <div key={c.title} style={{ padding: "16px 4px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ width: 38, height: 38, borderRadius: 12, flex: "none", display: "grid", placeItems: "center", background: c.tintBg, color: c.tint }}><PIcon name={c.icon} size={19} /></span>
            <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-.01em" }}>{c.title}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>{c.body}</p>
          <button onClick={c.onClick} style={{ marginTop: 12, background: "var(--primary-soft)", height: 36, padding: "0 16px", borderRadius: 999, fontSize: 13, fontWeight: 700, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {c.cta} <PIcon name="ph-caret-right" size={12} weight="bold" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── dispatcher ───────────────────────────────────────────────────────────────

export function CanvasBody({ type, symbol, nav }: { type: CanvasType; symbol: string; nav: ChatNav }) {
  switch (type) {
    case "market": return <MarketPanel nav={nav} />;
    // MONVERA has no stock data source (/api/market rejects it), so the stock
    // template would render dead stats and a fake chart — the token panel is
    // its real page no matter which list opened it.
    case "holding": return symbol === "MONVERA" ? <TokenPanel nav={nav} /> : <HoldingPanel symbol={symbol} nav={nav} />;
    case "portfolio": return <PortfolioPanel nav={nav} />;
    case "vera": return <VeraPanel />;
    case "wallet": return <WalletPanel nav={nav} />;
    case "token": return <TokenPanel nav={nav} />;
    case "autopilot": return <AutopilotPanel nav={nav} />;
    case "scan": return <ScanPanel nav={nav} />;
    case "activity": return <ActivityPanel />;
    case "insights": return <InsightsPanel nav={nav} />;
    case "alerts": return <AlertsCanvas nav={nav} />;
  }
}
