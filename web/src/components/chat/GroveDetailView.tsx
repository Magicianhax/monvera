"use client";

// The Grove detail page. Three zones and a footer, no strips:
//
//   1  identity header, naked on the background: logo stack, serif name, chips
//   2  stats band: ONE panel, 5 cells (position + the grove's public record)
//   3  the split: [holdings ledger + questions] left, [manage + terms] right —
//      the questions live under the ledger so the content column always
//      outruns the rail, and the rail is sticky so it follows the reader
//      instead of leaving a void (the dead-space bug this layout replaces)
//   4  a mono facts footer: contract, timelock, rebalance status
//
// Chromatic vocabulary, complete: green fills the page Buy button and nothing
// else. --pos/--neg carry deltas. Fraunces serif appears exactly twice, the
// grove name and the YOUR POSITION value. Every other numeral is mono/tnum.
//
// Everything shown is read from the chain or the registry. Where a thing is
// not running (rebalancing) the row says so instead of being hidden.
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { GroveLive } from "@/hooks/useGroves";
import type { GrovePositionLive } from "@/hooks/useGrovePosition";
import type { BacktestResult } from "@/lib/server/quant";
import { GROVE_MANAGER } from "@/lib/groveManager";
import { fullDiversificationUsd } from "@/lib/groves";
import { assetBySymbol } from "@/lib/tokens";
import { toTile, displayFor } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { AddrChip, PIcon, usd, usd0, dcol } from "./chatKit";

const EXPLORER = "https://robinhoodchain.blockscout.com";

const GVD_CSS = `
.gvd{container-type:inline-size}
/* Five cells, ONE row, always. No wrapping into 3+2 or 2+2+1 — a stat strip
   that re-stacks reads as a broken table. When the container is narrower than
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
.gvd-row{animation:gvdrise .32s cubic-bezier(.23,1,.32,1) both}
@media (prefers-reduced-motion: reduce){.gvd-row{animation:none}}
`;

// ── primitives ───────────────────────────────────────────────────────────────

const panel = (extra?: CSSProperties): CSSProperties => ({
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 20,
  ...extra,
});

const label: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

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

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Collapsed by default. Background and argument live here, not on the page. */
function Faq({ q, a }: { q: string; a: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--line-2)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 0", background: "none", border: "none", textAlign: "left", cursor: "pointer", color: "var(--ink)" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{q}</span>
        <span style={{ color: "var(--ink-3)", transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease", display: "grid", placeItems: "center", flex: "none" }}>
          <PIcon name="ph-caret-down" size={14} />
        </span>
      </button>
      {open && (
        <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--ink-2)", padding: "0 0 14px", whiteSpace: "pre-line" }}>{a}</div>
      )}
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
}: {
  g: GroveLive;
  position?: GrovePositionLive;
  smartAccount?: `0x${string}`;
  onBuy: () => void;
  onExit: () => void;
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
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)", padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>{g.category}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)", padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>
            {open ? "Open" : "Not open yet"}
          </span>
        </div>
        <h1 className="serif" style={{ margin: "10px 0 0", fontSize: "clamp(26px, 5cqw, 34px)", fontWeight: 500, letterSpacing: "-.018em", lineHeight: 1.05 }}>
          {g.name}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-2)", maxWidth: 560, textWrap: "pretty" }}>
          {g.thesis}
        </p>
      </div>

      {/* ── 2 · stats band: one panel, five cells ── */}
      <div style={panel({ overflow: "hidden" })}>
        <div className="gvd-stats">
          <div>
            <div style={label}>Your position</div>
            <div className="serif" style={{ fontSize: 24, fontWeight: 500, marginTop: 5, letterSpacing: "-.01em" }}>
              {held ? (unpriced ? "—" : usd(marketValue)) : "$0.00"}
            </div>
            <div className="tnum" style={{ fontSize: 11, color: held && !unpriced ? dcol(pnl) : "var(--ink-3)", marginTop: 2 }}>
              {held
                ? unpriced
                  ? "some holdings unpriced right now"
                  : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))} unrealized`
                : "nothing yet"}
            </div>
          </div>
          <div>
            <div style={label}>Total invested</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{usd0(g.stats.managedUsd)}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>cost basis, all holders</div>
          </div>
          <div>
            <div style={label}>Investors</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{g.stats.users.toLocaleString("en-US")}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>open positions</div>
          </div>
          <div>
            <div style={label}>Fees paid, ever</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6 }}>{usd(g.stats.feesUsd)}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>all holders, exit only</div>
          </div>
          <div>
            <div style={label}>1y vs S&amp;P</div>
            <div className="tnum" style={{ fontSize: 21, fontWeight: 600, marginTop: 6, color: bt ? dcol(bt.portfolio.returnPct) : "var(--ink)" }}>
              {bt ? `${bt.portfolio.returnPct >= 0 ? "+" : "−"}${Math.abs(bt.portfolio.returnPct).toFixed(1)}%` : "—"}
            </div>
            <div className="tnum" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
              {bt ? `S&P ${bt.benchmark.returnPct >= 0 ? "+" : "−"}${Math.abs(bt.benchmark.returnPct).toFixed(1)}% · history` : "backtest pending"}
            </div>
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
            <div style={{ fontSize: 14, fontWeight: 700 }}>What&rsquo;s inside</div>
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
                      mark + dollar value; a position that skipped a name (small
                      buys take the largest weights first) says so honestly. */}
                  {held && qty > 0 && (
                    <div className="tnum" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, marginTop: 1 }}>
                      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: "var(--pos)" }} />
                      <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                        you hold {qty.toFixed(6)}{mineUsd != null ? ` · ≈ ${usd(mineUsd)}` : ""}
                      </span>
                    </div>
                  )}
                  {held && qty === 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>not in your position · small buys take the largest weights first</div>
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

      <div style={panel({ padding: "15px 18px 4px" })}>
          <div style={label}>Questions</div>
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
              q="Does it rebalance?"
              a={`Not yet. ${g.rebalancePolicy.charAt(0).toUpperCase()}${g.rebalancePolicy.slice(1)}.\n\nThe contract supports automated management with caps you set yourself, but nothing is driving it today, so no rebalance has ever run. When that changes it will be announced first, and it will need your explicit opt-in.`}
            />
            <Faq
              q="How do I get my money out?"
              a={"Press Exit and choose how much: a quarter, half, three quarters, or everything. It sells in one transaction and returns USDG to your account.\n\nSelling everything closes the position and sells every holding to zero. The fee applies only to profit above what you paid, and is zero at a loss."}
            />
            <Faq
              q="What are the risks?"
              a={"You hold real equity exposure, so the basket falls when those companies fall, and it is concentrated rather than broadly diversified.\n\nEach buy and exit is a swap on a live venue, so you pay that venue's spread, priced into the quote you approve. Small buys pay proportionally more of it.\n\nBacktests on this page are history, not a forecast."}
            />
            {g.excluded && g.excluded.length > 0 && (
              <Faq q="What was left out, and why?" a={g.excluded.map((e) => `${e.symbol}: ${e.why}`).join("\n")} />
            )}
            <Faq
              q="Why did my buy not include every name?"
              a={`Each holding is bought with its own swap, and a swap has to be worth its own cost. Below about $11 a slice is not, so small buys concentrate into the largest weights and skip the tail. The buy screen lists exactly which names were left out before you confirm.\n\nFrom ${usd0(fullDiversificationUsd(g))} every one of the ${g.components.length} names is included.`}
            />
          </div>
        </div>
        </div>

        {/* right: your basket (when held), then manage, then terms */}
        <div className="gvd-right" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* YOUR basket, broken out on its own: what you actually hold, what
              each slice is worth, and its share of YOUR position — which can
              differ from the published weights (small buys concentrate into
              the largest names). The composition list answers "what is this
              grove"; this panel answers "what is mine". */}
          {held && (
            <div style={panel({ padding: "15px 18px 12px" })}>
              <div style={label}>Your basket</div>
              <div style={{ marginTop: 8 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 9, marginTop: 2, borderTop: "1px solid var(--line)", fontSize: 12 }}>
                <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>Total</span>
                <span className="tnum" style={{ fontWeight: 700 }}>{unpriced ? "—" : usd(marketValue)}</span>
              </div>
              {heldBySymbol.size < g.components.length && (
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 7 }}>
                  {g.components.length - heldBySymbol.size} of the grove&rsquo;s names aren&rsquo;t in your position — small buys take the largest weights first. Buying more adds them.
                </div>
              )}
            </div>
          )}

          <div style={panel({ padding: "15px 18px 16px" })}>
            <div style={label}>Manage</div>
            {held && (
              <div style={{ margin: "6px 0 4px" }}>
                <Row k="Cost basis" v={usd(basis)} />
                <Row k="Value now" v={unpriced ? "—" : usd(marketValue)} sub={unpriced ? "some holdings unpriced right now" : undefined} />
                {!unpriced && (
                  <Row k="Profit / loss" v={`${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`} color={dcol(pnl)} strong />
                )}
                {!unpriced && (
                  <Row k="Fee if you exit now" v={feeNow > 0 ? usd(feeNow) : "$0.00"} sub={feeNow > 0 ? `${feePct}% of profit` : "no profit, no fee"} />
                )}
              </div>
            )}
            <button
              onClick={onBuy}
              disabled={!open}
              style={{
                width: "100%",
                height: 46,
                marginTop: held ? 8 : 10,
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
            <button
              onClick={onExit}
              disabled={!held}
              style={{ width: "100%", height: 42, marginTop: 8, borderRadius: 13, fontSize: 13.5, fontWeight: 600, border: "1px solid var(--line)", background: "transparent", color: held ? "var(--ink)" : "var(--ink-3)", cursor: held ? "pointer" : "default" }}
            >
              Exit
            </button>
            <div className="tnum" style={{ fontSize: 10.5, color: "var(--ink-3)", textAlign: "center", marginTop: 7 }}>
              {held ? "One transaction each way, gas covered" : open ? `From ${usd0(g.minBuyUsd)} · all ${g.components.length} names from ${usd0(fullDiversificationUsd(g))}` : "Buys open when the contract is live"}
            </div>
          </div>

          <div style={panel({ padding: "15px 18px 8px" })}>
            <div style={label}>Terms and custody</div>
            <div style={{ marginTop: 6 }}>
              <Row k="Buy, hold, exit at a loss" v="$0" />
              <Row k="Exit in profit" v={`${feePct}% of the profit`} sub="never the principal" strong />
              <Row
                k="Your basket sits at"
                v={smartAccount ? <AddrChip addr={smartAccount} /> : "your own account"}
                sub="only you can move it"
              />
              <Row k="We can pause new buys" v="yes" sub="a safety switch, nothing more" />
              <Row k="We can touch your holdings" v="no" sub="no such function exists" />
            </div>
          </div>
        </div>
      </div>


      {/* ── facts footer ── */}
      <div className="mono" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "2px 6px 4px", fontSize: 11.5, color: "var(--ink-3)", borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
        {GROVE_MANAGER && (
          <a href={`${EXPLORER}/address/${GROVE_MANAGER}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-3)", textDecoration: "none" }}>
            <PIcon name="ph-arrow-square-out" size={13} /> contract {short(GROVE_MANAGER)}
          </a>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <PIcon name="ph-lock-simple" size={13} /> composition changes wait 48h on-chain
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <PIcon name="ph-clock" size={13} /> last rebalance: never, no automation runs
        </span>
      </div>
    </div>
  );
}
