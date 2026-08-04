"use client";

// The Grove detail page. Four zones and a footer, no strips:
//
//   1  identity header, naked on the background: logo stack, chips, serif name
//   2  stats band: ONE panel, 4 cells (the grove's public record + the fee)
//   3  the split: [holdings ledger + questions] left, [money + managed] right —
//      the questions live under the ledger so the content column always
//      outruns the rail, and the rail is sticky so it follows the reader
//      instead of leaving a void (the dead-space bug this layout replaces)
//   4  a mono facts footer: contract, timelock, rebalance status
//
// Chromatic vocabulary, complete: green fills the page Buy button and nothing
// else. --pos/--neg carry deltas. Fraunces serif appears exactly ONCE, the
// grove name. Every other numeral is mono/tnum. Every fact has ONE home on
// this page: the fee in the stats band, the rebalance cadence in its FAQ,
// the last-rebalance date in the footer.
//
// Everything shown is read from the chain or the registry. Where a thing is
// not running (rebalancing) the row says so instead of being hidden.
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useGroveHistory, useGroveChecks, type GroveHistory, type GroveLive } from "@/hooks/useGroves";
import type { GrovePositionLive } from "@/hooks/useGrovePosition";
import type { BacktestResult } from "@/lib/server/quant";
import { GROVE_MANAGER } from "@/lib/groveManager";
import { assetBySymbol } from "@/lib/tokens";
import { toTile, displayFor } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { AddrChip, PIcon, usd, usd0, dcol } from "./chatKit";
import { GroveAutoPanel } from "./GroveAutoPanel";

const EXPLORER = "https://robinhoodchain.blockscout.com";

const GVD_CSS = `
.gvd{container-type:inline-size}
/* Five cells, ONE row, always. No wrapping — a stat strip that
   re-stacks reads as a broken table. When the container is narrower than
   five readable cells (~146px each), the strip scrolls sideways instead:
   native swipe on phones, cells at full legibility, dividers always vertical.
   This also deletes the whole breakpoint/divider cascade a wrap needs. */
.gvd-stats{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(146px,1fr);overflow-x:auto;scrollbar-width:none}
.gvd-stats::-webkit-scrollbar{display:none}
.gvd-stats>div{padding:14px 16px;border-left:1px solid var(--line-2)}
.gvd-stats>div:first-child{border-left:none}
.gvd-split{display:grid;gap:12px;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);align-items:start}
/* The rail follows the reader once the ledger column grows past it — the
   action card stays reachable without ever leaving a void below the content.
   Range syntax so the pair partitions the axis exactly: fractional widths in
   a (760,761) gap would otherwise render 2-col with a non-sticky rail. */
@container (width >= 761px){.gvd-right{position:sticky;top:12px}}
@container (width < 761px){.gvd-split{grid-template-columns:1fr}.gvd-right{order:-1}}
.gvd-px{display:none}
@container (min-width:640px){.gvd-px{display:block}}
/* Own keyframe for the ledger's deal-in. NOT the house .fadein class: in the
   mobile context .mvm .fadein doubles as the bottom-sheet scrim override and
   sets padding:0!important, which would crush these rows. */
@keyframes gvdrise{from{opacity:.001;transform:translateY(8px)}to{opacity:1;transform:none}}
.gvd-row{animation:gvdrise .28s cubic-bezier(.23,1,.32,1) both}
/* Press affordance: transform only, never "all". */
.gvd-press{transition:transform .16s ease-out}
.gvd-press:active{transform:scale(.97)}
/* Expand/collapse: always-mounted grid rows, so the transition is
   interruptible by construction. Opens at 220ms, closes at 180ms (exits
   faster than enters); the chevron turns on the open clock both ways. */
.gvd-clp{display:grid;grid-template-rows:0fr;transition:grid-template-rows .18s cubic-bezier(.23,1,.32,1)}
.gvd-clp[data-open="true"]{grid-template-rows:1fr;transition-duration:.22s}
.gvd-clp>div{overflow:hidden;min-height:0}
.gvd-chev{display:inline-flex;color:var(--ink-3);transition:transform .22s cubic-bezier(.23,1,.32,1)}
.gvd-chev[data-open="true"]{transform:rotate(180deg)}
@media (prefers-reduced-motion: reduce){
  .gvd-row{animation:none}
  .gvd-clp,.gvd-chev,.gvd-press{transition:none}
  .gvd-press:active{transform:none}
}
`;

// ── primitives ───────────────────────────────────────────────────────────────

const panel = (extra?: CSSProperties): CSSProperties => ({
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 20,
  ...extra,
});

// Headings carry their own weight: real size and color, sentence case — no
// uppercase, no tracking, anywhere on this page.
const heading: CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--ink)" };
const caption: CSSProperties = { fontSize: 11.5, fontWeight: 500, color: "var(--ink-3)" };

/** One entry in the Rebalances timeline: a window Vera checked this basket in,
 *  or a change to the grove's published recipe. */
interface TimelineRow {
  key: string;
  /** Epoch MILLISECONDS. */
  at: number;
  title: string;
  detail: string;
  txHash?: string;
  outcome: string;
}

/** Pager button. Disabled is dimmed and inert rather than hidden, so the
 *  control does not move as the reader pages through. */
const pagerBtn = (disabled: boolean): CSSProperties => ({
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 24,
  borderRadius: 7,
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  color: disabled ? "var(--ink-3)" : "var(--ink-2)",
  opacity: disabled ? 0.45 : 1,
  cursor: disabled ? "default" : "pointer",
  padding: 0,
});

/** Icon per outcome. A check that traded nothing must not wear the same face
 *  as one that moved money — the whole point of the row is that the difference
 *  is visible at a glance. */
function timelineIcon(outcome: string): string {
  if (outcome === "rebalanced" || outcome === "unconfirmed") return "ph-arrows-clockwise";
  if (outcome === "composition") return "ph-sliders-horizontal";
  if (outcome === "failed") return "ph-warning";
  return "ph-check"; // every "checked, did nothing" outcome
}

/** A labelled fact row. */
function Row({ k, v, sub, strong, color }: { k: ReactNode; v: ReactNode; sub?: ReactNode; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line-2)" }}>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{k}</div>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: "right" }}>
        <div className="tnum" style={{ fontSize: 13, fontWeight: strong ? 700 : 500, color: color ?? "var(--ink)" }}>{v}</div>
        {sub !== undefined && <div className="tnum" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

/** The next acting window. Mirrors the driver's cron schedule exactly:
 *  00/06/12/18 UTC daily plus 13:30 UTC on weekdays (the market-open fire).
 *  The driver acts in ANY window where the touched Chainlink rounds are
 *  fresh — tokenized markets trade around the clock, so there is no
 *  market-hours clock here; weekend windows can still pass without action
 *  when the feeds themselves have gone stale. */
function nextActingWindow(now: number): number {
  const d = new Date(now);
  let best = Number.POSITIVE_INFINITY;
  for (let dayOff = 0; dayOff <= 3; dayOff++) {
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOff);
    for (const [h, m] of [[0, 0], [6, 0], [12, 0], [13, 30], [18, 0]] as const) {
      const t = base + (h * 60 + m) * 60_000;
      const day = new Date(t).getUTCDay();
      if (m === 30 && (day === 0 || day === 6)) continue; // open fire is weekdays only
      if (t > now && t < best) best = t;
    }
  }
  return best;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** Live countdown to the next window Vera can act in. Ticks every second —
 *  a stat cell, not motion, so no reduced-motion variant is needed. */
function NextWindowCell({ open }: { open: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!open) {
    return (
      <>
        <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>—</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>starts when the grove opens</div>
      </>
    );
  }
  return (
    <>
      <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{fmtCountdown(nextActingWindow(now) - now)}</div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>every 6 hours, only on real drift</div>
    </>
  );
}

/** "Jul 27, 2026" — block-stamp precision; "—" when no source carried one. */
function fmtWhen(at: number | null) {
  return at ? new Date(at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

/** Clock time, local to the reader. Vera checks four times a day, so a row
 *  carrying only a date renders as four identical "Aug 4"s and the reader
 *  cannot tell which window they are looking at — or that there were four. */
function fmtClock(at: number | null) {
  return at ? new Date(at * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
}

/** Short date for a dense row: no year, because every row in this panel is
 *  recent and the year repeated eight times is noise. */
function fmtDay(at: number | null) {
  return at ? new Date(at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Collapsed by default. Background and argument live here, not on the page.
 *  The answer stays mounted (the .gvd-clp grid collapse); when closed it is
 *  inert + aria-hidden so its links drop out of the tab order. */
function Faq({ q, a }: { q: string; a: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--line-2)" }}>
      <button
        className="gvd-press"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 0", background: "none", border: "none", textAlign: "left", cursor: "pointer", color: "var(--ink)" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{q}</span>
        <span className="gvd-chev" data-open={open} style={{ flex: "none" }}>
          <PIcon name="ph-caret-down" size={14} />
        </span>
      </button>
      <div className="gvd-clp" data-open={open}>
        <div aria-hidden={!open} inert={!open}>
          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--ink-2)", padding: "0 0 14px", whiteSpace: "pre-line" }}>{a}</div>
        </div>
      </div>
    </div>
  );
}

/** 1Y backtest vs buy-and-hold SPY (dashed). Lives in the FAQ: evidence for
 *  people who go looking, not a headline claim. */
function BacktestChart({ bt, height = 130 }: { bt: BacktestResult; height?: number }) {
  const W = 640;
  const all = [...bt.portfolio.curve, ...bt.benchmark.curve];
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const pad = Math.max(6, height * 0.07);
  const pts = (curve: number[]) =>
    curve.map((v, i) => `${((i / (curve.length - 1)) * W).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`).join(" ");
  const plan = pts(bt.portfolio.curve);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} role="img"
      aria-label={`One year backtest: the grove returned ${bt.portfolio.returnPct.toFixed(1)} percent against ${bt.benchmark.returnPct.toFixed(1)} percent for the S&P 500`}>
      <polygon points={`0,${height} ${plan} ${W},${height}`} fill="var(--ink-3)" opacity={0.08} />
      <polyline points={pts(bt.benchmark.curve)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
      <polyline points={plan} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export function GroveDetailView({
  g,
  position,
  smartAccount,
  onBuy,
  onExit,
  autoFocus,
}: {
  g: GroveLive;
  position?: GrovePositionLive;
  smartAccount?: `0x${string}`;
  onBuy: () => void;
  onExit: () => void;
  /** Deep link (?auto=1 / chat): scroll the Auto-manage panel into view. */
  autoFocus?: boolean;
}) {
  const feePct = g.feeBps / 100;
  const open = g.onChainId !== undefined;
  const held = position?.open ?? false;
  const bt = g.backtest;

  // Value the position at the same prices the ledger shows, so the two can
  // never disagree on this page.
  const priceOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of g.components) if (c.priceUsd != null) m.set(c.symbol, c.priceUsd);
    return m;
  }, [g.components]);

  const heldBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    if (!position) return m;
    for (const c of g.components) {
      const addr = assetBySymbol(c.symbol)?.address?.toLowerCase();
      if (!addr) continue;
      const h = position.holdings.find((x) => x.token.toLowerCase() === addr);
      if (h) m.set(c.symbol, Number(h.amount) / 1e18);
    }
    return m;
  }, [position, g.components]);

  // A partial sum would show a fake loss whenever one feed is down, so the
  // value is either complete or declared unavailable, never quietly short.
  const { marketValue, unpriced } = useMemo(() => {
    let v = 0;
    let missing = false;
    for (const [sym, qty] of heldBySymbol) {
      const px = priceOf.get(sym);
      if (px == null) missing = true;
      else v += qty * px;
    }
    // Tokens still held from an older composition are not in g.components at
    // all, so heldBySymbol never saw them. Count them as unpriced too.
    const mapped = new Set(
      [...heldBySymbol.keys()].map((sym) => assetBySymbol(sym)?.address?.toLowerCase()).filter(Boolean),
    );
    for (const h of position?.holdings ?? []) {
      if (Number(h.amount) > 0 && !mapped.has(h.token.toLowerCase())) missing = true;
    }
    return { marketValue: v, unpriced: missing };
  }, [heldBySymbol, priceOf, position]);

  const basis = position?.costBasisUsd ?? 0;
  const pnl = marketValue - basis;
  const feeNow = pnl > 0 ? pnl * (g.feeBps / 10_000) : 0;

  const byWeight = useMemo(() => g.components.slice().sort((a, b) => b.weightBps - a.weightBps), [g.components]);
  const top5 = byWeight.slice(0, 5);

  // Both breakdowns are collapsed by default. Their headers carry the answer
  // most visits need (the total; the count and last date).
  const [basketOpen, setBasketOpen] = useState(false);
  const [rebalOpen, setRebalOpen] = useState(false);

  // Every on-chain touch of this grove — member rebalances + recipe changes.
  // null = still reading (or not on-chain yet); [] = the honest "never".
  const history = useGroveHistory(open ? g.id : null);
  const historyRows: GroveHistory["rows"] | null = history.data?.rows ?? null;
  const lastRebalance = historyRows?.find((r) => r.kind === "rebalance") ?? null;

  // Every window Vera checked THIS basket in, including the ones that traded
  // nothing. Without it the panel could only ever show rebalances that
  // happened, so a basket managed perfectly read as one nobody was watching.
  const checks = useGroveChecks(open ? g.id : null, smartAccount ?? null);

  // One timeline: the holder's own checks, plus the grove-wide recipe changes
  // (which no per-user row covers). A `rebalanced` check already carries its
  // own txHash, so on-chain rebalance rows are NOT merged in — that would list
  // the same event twice. The explorer link below stays the route to
  // everyone's rebalances.
  const timeline = useMemo(() => {
    const rows: TimelineRow[] = [];
    for (const c of checks.data?.rows ?? []) {
      rows.push({ key: `c${c.at}${c.outcome}`, at: c.at, title: c.title, detail: c.detail, txHash: c.txHash, outcome: c.outcome });
    }
    for (const r of historyRows ?? []) {
      // A log whose block timestamp did not come back has no place on a
      // timeline: sorting it to either end would state a time we do not know.
      // It stays visible on the explorer link below.
      if (r.kind !== "composition" || r.at === null) continue;
      rows.push({
        key: `x${r.txHash}`,
        at: r.at * 1000, // chain rows are seconds; check rows are ms
        title: `Recipe updated to v${r.version}`,
        detail: r.names ? `The published basket became ${r.names} names.` : "The published basket changed.",
        txHash: r.txHash,
        outcome: "composition",
      });
    }
    return rows.sort((a, b) => b.at - a.at);
  }, [checks.data, historyRows]);

  const PAGE = 5;
  const [rebalPage, setRebalPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(timeline.length / PAGE));
  // A list that shrinks under you (a new window lands) must never strand the
  // reader on a page that no longer exists.
  const page = Math.min(rebalPage, pageCount - 1);
  const pageRows = timeline.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="gvd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{GVD_CSS}</style>

      {/* ── 1 · identity, naked on the background ── */}
      <div style={{ padding: "4px 4px 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* the basket is visible before a single number is read */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {top5.map((c, i) => (
              <div key={c.symbol} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: 9, border: "2px solid var(--panel-2)", background: "var(--panel-2)", zIndex: 5 - i, lineHeight: 0 }}>
                <AssetTile asset={toTile(c.symbol)} size={22} radius={7} />
              </div>
            ))}
            {g.components.length > 5 && (
              <span className="tnum" style={{ marginLeft: 6, padding: "3px 8px", borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--line)", fontSize: 10.5, fontWeight: 700, color: "var(--ink-2)" }}>
                +{g.components.length - 5}
              </span>
            )}
          </div>
          <span className="tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>{g.ticker}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>{g.category}</span>
          {!open && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>
              Opens soon
            </span>
          )}
        </div>
        <h1 className="serif" style={{ margin: "10px 0 0", fontSize: "clamp(26px, 5cqw, 34px)", fontWeight: 500, letterSpacing: "-.018em", lineHeight: 1.05 }}>
          {g.name}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-2)", maxWidth: 560, textWrap: "pretty" }}>
          {g.thesis}
        </p>
      </div>

      {/* ── 2 · stats band: four grove-level facts. The user's own money lives
             in ONE place, the rail's position card — never duplicated here. ── */}
      <div style={panel({ overflow: "hidden" })}>
        <div className="gvd-stats">
          <div>
            <div style={caption}>1y vs S&amp;P</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6, color: bt ? dcol(bt.portfolio.returnPct) : "var(--ink)" }}>
              {bt ? `${bt.portfolio.returnPct >= 0 ? "+" : "−"}${Math.abs(bt.portfolio.returnPct).toFixed(1)}%` : "—"}
            </div>
            <div className="tnum" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
              {bt ? `S&P ${bt.benchmark.returnPct >= 0 ? "+" : "−"}${Math.abs(bt.benchmark.returnPct).toFixed(1)}% · history, not a promise` : "backtest pending"}
            </div>
          </div>
          <div>
            <div style={caption}>Investors</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{g.stats.users.toLocaleString("en-US")}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>open positions, on-chain</div>
          </div>
          <div>
            <div style={caption}>Total invested</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{usd0(g.stats.managedUsd)}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>cost basis, all holders</div>
          </div>
          <div>
            <div style={caption}>The only fee</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{feePct}%</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>of profit, only at exit</div>
          </div>
          <div>
            <div style={caption}>Next rebalance window</div>
            <NextWindowCell open={open} />
          </div>
        </div>
      </div>

      {/* ── 3 · the split ── */}
      <div className="gvd-split">
        {/* left: the ledger, then the questions — one column, so the reading
            flow is holdings -> evidence, and the rail never towers over a
            finished content column (the dead-space bug this layout replaces) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={panel({ padding: "15px 18px 8px" })}>
          {/* This is the grove's published RECIPE, not anyone's holdings —
              "Your basket" in the right rail is what the user owns. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={heading}>What&rsquo;s inside</div>
            <div className="tnum" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>
              {g.components.length} names · fixed weights
            </div>
          </div>

          {/* segmented allocation bar: composition at a glance */}
          <div className="wipe" style={{ display: "flex", gap: 2, height: 8, borderRadius: 99, overflow: "hidden", margin: "12px 0 4px" }}>
            {byWeight.map((c) => (
              <div key={c.symbol} title={`${c.symbol} ${c.weightBps / 100}%`} style={{ width: `${c.weightBps / 100}%`, minWidth: 3, background: displayFor(c.symbol).color, opacity: 0.9 }} />
            ))}
          </div>

          {byWeight.map((c, i) => {
            const qty = heldBySymbol.get(c.symbol) ?? 0;
            const px = priceOf.get(c.symbol);
            const mineUsd = qty > 0 && px != null ? qty * px : null;
            return (
              <div key={c.symbol} className="gvd-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-2)", animationDelay: `${0.12 + Math.min(i, 7) * 0.045}s` }}>
                <AssetTile asset={toTile(c.symbol)} size={28} radius={9} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.symbol}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  </div>
                  {/* Which names are YOURS, at a glance: held rows get a green
                      mark + dollar value; a skipped name says so honestly (the
                      why lives in the FAQ, once). */}
                  {held && qty > 0 && (
                    <div className="tnum" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, marginTop: 1 }}>
                      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: "var(--pos)" }} />
                      <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                        you hold {qty.toFixed(6)}{mineUsd != null ? ` · ≈ ${usd(mineUsd)}` : ""}
                      </span>
                    </div>
                  )}
                  {held && qty === 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>not in your position yet</div>
                  )}
                </div>
                <div className="gvd-px tnum" style={{ fontSize: 12, color: "var(--ink-3)", flex: "none" }}>
                  {px != null ? usd(px) : ""}
                </div>
                <div style={{ textAlign: "right", flex: "none", width: 62 }}>
                  <div className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{(c.weightBps / 100).toFixed(0)}%</div>
                  <div style={{ width: 56, height: 3, borderRadius: 2, background: "var(--line-2)", marginTop: 4, marginLeft: "auto" }}>
                    <div style={{ width: `${c.weightBps / 100}%`, height: "100%", borderRadius: 2, background: "var(--ink-3)" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Rebalance history, collapsed to its one-line truth by default: the
            summary IS the claim ("nothing has ever touched this basket", or
            the count — the last DATE lives in the footer, once). The receipts
            are one tap away, each row linking to its transaction. Panel
            padding never changes with open state; the collapse owns all the
            moving height. */}
        <div style={panel({ padding: "15px 18px" })}>
          <button
            className="gvd-press"
            onClick={() => setRebalOpen((v) => !v)}
            aria-expanded={rebalOpen}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <span style={heading}>Rebalances</span>
            <span className="tnum" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>
              {/* The summary counts CHECKS, not transactions. "0 on-chain" was
                  true and still read as "nothing is running", which is the
                  opposite of what three clean checks mean. */}
              {!open
                ? "starts when the grove opens"
                : historyRows === null && checks.isLoading
                  ? "reading…"
                  : timeline.length === 0
                    ? held
                      ? "no checks recorded yet"
                      : "none yet, straight from the chain"
                    : `${timeline.length} check${timeline.length === 1 ? "" : "s"}`}
            </span>
            <span className="gvd-chev" data-open={rebalOpen}>
              <PIcon name="ph-caret-down" size={13} />
            </span>
          </button>
          <div className="gvd-clp" data-open={rebalOpen}>
            <div aria-hidden={!rebalOpen} inert={!rebalOpen}>
              {!open ? (
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 8 }}>
                  Starts recording the moment this grove opens on-chain.
                </div>
              ) : history.isError ? (
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 8 }}>
                  Couldn&rsquo;t read the chain just now. The history is still there; this page just can&rsquo;t show it this minute.
                </div>
              ) : historyRows === null && checks.isLoading ? (
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>reading&hellip;</div>
              ) : timeline.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 8 }}>
                  {held
                    ? "Vera has not recorded a check on this basket yet. She looks every six hours, and each look lands here whether or not it moves anything."
                    : "Nothing has ever touched this basket. Every rebalance is its own transaction, and each one lands here the moment it happens."}
                </div>
              ) : (
                <>
                  {pageRows.map((r, i) => (
                    <div key={r.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
                      <span aria-hidden style={{ width: 28, height: 28, borderRadius: 9, flex: "none", display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                        <PIcon name={timelineIcon(r.outcome)} size={14} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 650 }}>{r.title}</div>
                        {/* The reason is the row. A check that traded nothing is
                            only meaningful if it says why. */}
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 2 }}>{r.detail}</div>
                        {r.txHash && (
                          <a className="tnum gvd-press" href={`${EXPLORER}/tx/${r.txHash}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--ink-3)", textDecoration: "none", marginTop: 3 }}>
                            transaction <PIcon name="ph-arrow-square-out" size={10} />
                          </a>
                        )}
                      </div>
                      <div className="tnum" style={{ flex: "none", paddingTop: 1, textAlign: "right" }}>
                        <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{fmtDay(r.at / 1000)}</div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>{fmtClock(r.at / 1000)}</div>
                      </div>
                    </div>
                  ))}
                  {pageCount > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 9, borderTop: "1px solid var(--line-2)" }}>
                      <button
                        className="gvd-press"
                        onClick={() => setRebalPage(Math.max(0, page - 1))}
                        disabled={page === 0}
                        aria-label="Previous page"
                        style={pagerBtn(page === 0)}
                      >
                        <PIcon name="ph-caret-left" size={12} />
                      </button>
                      <span className="tnum" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {page + 1} of {pageCount}
                      </span>
                      <button
                        className="gvd-press"
                        onClick={() => setRebalPage(Math.min(pageCount - 1, page + 1))}
                        disabled={page >= pageCount - 1}
                        aria-label="Next page"
                        style={{ ...pagerBtn(page >= pageCount - 1), marginRight: "auto" }}
                      >
                        <PIcon name="ph-caret-right" size={12} />
                      </button>
                      {GROVE_MANAGER && (
                        <a
                          className="gvd-press"
                          href={`${EXPLORER}/address/${GROVE_MANAGER}?tab=logs`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "var(--ink-3)", textDecoration: "none" }}
                        >
                          everyone&rsquo;s, on the explorer
                        </a>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

      <div style={panel({ padding: "15px 18px 4px" })}>
          <div style={heading}>Questions</div>
          <div style={{ marginTop: 6 }}>
            <Faq q="What am I actually buying?" a={g.longThesis} />
            {bt && (
              <Faq
                q="How has it performed?"
                a={
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      Last year this basket returned {bt.portfolio.returnPct >= 0 ? "+" : "−"}
                      {Math.abs(bt.portfolio.returnPct).toFixed(1)}% against {bt.benchmark.returnPct >= 0 ? "+" : "−"}
                      {Math.abs(bt.benchmark.returnPct).toFixed(1)}% for the S&amp;P 500, with a worst dip of −
                      {Math.abs(bt.portfolio.maxDrawdownPct).toFixed(1)}%.
                    </div>
                    <BacktestChart bt={bt} />
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>
                      Solid line this basket, dashed the S&amp;P 500. History replayed at today&rsquo;s weights, not a forecast.
                    </div>
                  </div>
                }
              />
            )}
            <Faq q="How is the basket chosen and weighted?" a={g.methodology.replace(/\*\*/g, "")} />
            <Faq
              q="Who actually holds my basket?"
              a={
                <div>
                  You do. The stocks sit in your own account{smartAccount ? <> (<AddrChip addr={smartAccount} />)</> : null}, not in a pool and not
                  behind a wrapper token. If management is on, the GroveManager contract holds one standing
                  permission: it can sell and rebuy inside this basket to hold the published weights. Every
                  price it trades at is checked against Chainlink on-chain, every trade runs on a whitelisted
                  venue, and it cannot send anything anywhere but your own account. You can revoke that
                  permission instantly, even while the contract is paused, and only you can withdraw.
                </div>
              }
            />
            <Faq
              q="Does it rebalance?"
              a={
                open
                  ? "Yes, actively. Every six hours, around the clock, Vera sets the basket's target weights herself, reading each holding's momentum, volatility and news. She may scale any published weight between 0.7x and 1.3x and nothing else: she cannot add a name, drop one, or move to cash, and those limits are applied in code to her answer before anything is traded. If her judgment is unavailable, the published weights stand. Everyone in the grove is managed together, in proportion to what they hold.\n\nYou can switch management off at buy time or any time after, instantly, in the Managed card. The list above shows every window she checked and what she decided, including the ones that traded nothing."
                  : "Yes, once it opens. From your first buy, Vera sets the basket's target weights every six hours, around the clock, within 0.7x to 1.3x of the published ones, and realigns when your position no longer matches them and the on-chain prices are fresh.\n\nYou can switch management off at buy time or any time after, instantly, in the Managed card."
              }
            />
            <Faq
              q="How do I get my money out?"
              a={"Press Exit and choose how much: a quarter, half, three quarters, or everything. It sells in one transaction and returns cash to your account.\n\nSelling everything closes the position."}
            />
            <Faq
              q="What are the risks?"
              a={"You hold real equity exposure, so the basket falls when those companies fall, and it is concentrated rather than broadly diversified.\n\nEach buy and exit is a swap on a live venue, so you pay that venue's spread, priced into the quote you approve. Small buys pay proportionally more of it.\n\nBacktests on this page are history, not a forecast."}
            />
            {g.excluded && g.excluded.length > 0 && (
              <Faq q="What was left out, and why?" a={g.excluded.map((e) => `${e.symbol}: ${e.why}`).join("\n")} />
            )}
            <Faq
              q="Does a smaller buy get a smaller basket?"
              a={`No. Every buy holds all ${g.components.length} names at the published weights, whether you put in ${usd0(g.minBuyUsd)} or ${usd0(g.minBuyUsd * 50)}. The minimum is set at ${usd0(g.minBuyUsd)} precisely so the smallest weight is still worth buying, which is what makes every holder's basket the same shape and lets one decision manage all of them in proportion.\n\nThe whole basket settles in a single transaction, so you get all of it or none of it.`}
            />
          </div>
        </div>
        </div>

        {/* right rail: exactly two cards. The money card is the ONE place the
            user's own numbers and both actions live; auto-manage is the one
            standing decision. Everything else on the page is about the grove. */}
        <div className="gvd-right" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panel({ padding: "16px 18px" })}>
            {held ? (
              <>
                <div style={caption}>Your position</div>
                <div className="tnum" style={{ fontSize: 26, fontWeight: 650, marginTop: 5, letterSpacing: "-.01em" }}>
                  {unpriced ? "—" : usd(marketValue)}
                </div>
                <div className="tnum" style={{ fontSize: 11.5, color: unpriced ? "var(--ink-3)" : dcol(pnl), marginTop: 2 }}>
                  {unpriced ? "some holdings unpriced right now" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))} since you bought`}
                </div>
                <div style={{ margin: "8px 0 2px" }}>
                  <Row k="You put in" v={usd(basis)} />
                  {/* The user's own computed number, not fee terms — the terms
                      live in the stats band, once. */}
                  {!unpriced && (
                    <Row k="Fee if you exit now" v={feeNow > 0 ? usd(feeNow) : "$0.00"} sub={feeNow > 0 ? undefined : "no profit, no fee"} />
                  )}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 0 }}>Own this basket</div>
                <p style={{ margin: "8px 0 2px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                  From {usd0(g.minBuyUsd)}, settled straight into your own wallet.
                </p>
              </>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                className="gvd-press"
                onClick={onBuy}
                disabled={!open}
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 13,
                  fontSize: 14,
                  fontWeight: 700,
                  // The page's one green.
                  background: open ? "linear-gradient(180deg,var(--primary-2),var(--primary))" : "var(--line)",
                  border: "1px solid color-mix(in srgb,var(--primary) 70%,#000 8%)",
                  color: open ? "#fff" : "var(--ink-3)",
                  cursor: open ? "pointer" : "default",
                }}
              >
                Buy
              </button>
              {held && (
                <button
                  className="gvd-press"
                  onClick={onExit}
                  style={{ flex: 1, height: 46, borderRadius: 13, fontSize: 13.5, fontWeight: 600, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)", cursor: "pointer" }}
                >
                  Exit
                </button>
              )}
            </div>
            {held ? (
              <>
                {/* The per-name breakdown, one tap away. Most visits only need
                    the headline above. */}
                <button
                  className="gvd-press"
                  onClick={() => setBasketOpen((v) => !v)}
                  aria-expanded={basketOpen}
                  style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", marginTop: 12, paddingTop: 10, border: "none", borderTop: "1px solid var(--line-2)", background: "none", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-2)" }}>
                    Your {heldBySymbol.size} {heldBySymbol.size === 1 ? "holding" : "holdings"}
                  </span>
                  <span className="gvd-chev" data-open={basketOpen} style={{ marginLeft: "auto" }}>
                    <PIcon name="ph-caret-down" size={13} />
                  </span>
                </button>
                <div className="gvd-clp" data-open={basketOpen}>
                  <div aria-hidden={!basketOpen} inert={!basketOpen}>
                    <div style={{ marginTop: 4 }}>
                      {[...heldBySymbol.entries()]
                        .map(([sym, qty]) => {
                          const px = priceOf.get(sym);
                          return { sym, qty, usdVal: px != null ? qty * px : null };
                        })
                        .sort((a, b) => (b.usdVal ?? 0) - (a.usdVal ?? 0))
                        .map((r, i) => (
                          <div key={r.sym} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
                            <AssetTile asset={toTile(r.sym)} size={24} radius={8} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{r.sym}</div>
                              <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{r.qty.toFixed(6)}</div>
                            </div>
                            <div style={{ textAlign: "right", flex: "none" }}>
                              <div className="tnum" style={{ fontSize: 12.5, fontWeight: 650 }}>{r.usdVal != null ? usd(r.usdVal) : "—"}</div>
                              <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                                {r.usdVal != null && marketValue > 0 && !unpriced ? Math.round((r.usdVal / marketValue) * 100) + "% of yours" : ""}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                    {heldBySymbol.size < g.components.length && (
                      <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 5 }}>
                        {g.components.length - heldBySymbol.size} of the grove&rsquo;s names aren&rsquo;t in your position yet. Buying more adds them.
                      </div>
                    )}
                  </div>
                </div>
                <div className="tnum" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 10.5, color: "var(--ink-3)", marginTop: 10 }}>
                  in your own account{smartAccount ? <AddrChip addr={smartAccount} /> : null}
                </div>
              </>
            ) : (
              <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-3)", textAlign: "center", marginTop: 8 }}>
                {open ? `All ${g.components.length} names, every buy` : "Buys open when the contract is live"}
              </div>
            )}
          </div>

          <GroveAutoPanel g={g} held={held} autoFocus={autoFocus} />
        </div>
      </div>


      {/* ── facts footer ── */}
      <div className="mono" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "2px 6px 4px", fontSize: 11.5, color: "var(--ink-3)", borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
        {GROVE_MANAGER && (
          <a className="gvd-press" href={`${EXPLORER}/address/${GROVE_MANAGER}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-3)", textDecoration: "none" }}>
            <PIcon name="ph-arrow-square-out" size={13} /> contract {short(GROVE_MANAGER)}
          </a>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <PIcon name="ph-lock-simple" size={13} /> composition changes wait 48h on-chain
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <PIcon name="ph-clock" size={13} />{" "}
          {lastRebalance
            ? `last rebalance: ${fmtWhen(lastRebalance.at)}, ${fmtClock(lastRebalance.at)}`
            : "last rebalance: never yet"}
        </span>
      </div>
    </div>
  );
}
