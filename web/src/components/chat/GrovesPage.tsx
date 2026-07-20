"use client";

// Groves — FULL PAGES inside the Vera app (the "Monvera Chat" design language),
// desktop center takeover + mobile sheet. The shelf lists every Grove; the
// detail page shows composition, backtest, methodology, exclusions, and fees.
// Data comes from the public /api/groves endpoints (same registry + live layer
// as the site pages — no duplicate logic); Buy drives the existing grove_buy
// chat flow via nav.askVera, exactly like the /app?grove= deep link always has.
//
// Glass idiom: panels MUST inline `background: "var(--panel)"` first so the
// CHAT_THEME_CSS highlight selector bites. These are public numbers — the
// hidden-balances privacy rule does not apply here.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { groveById, fullDiversificationUsd, MIN_LEG_USD, RECOMMENDED_BUY_USD } from "@/lib/groves";
import { useGrovesList, useGroveLive, type GroveLive } from "@/hooks/useGroves";
import type { BacktestResult } from "@/lib/server/quant";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { GroveCover } from "@/components/GroveCover";
import { PIcon, usd0, pctStr, priceStr, dcol, type ChatNav } from "./chatKit";

// ── shared bits ──────────────────────────────────────────────────────────────

/** Plain glass card (background FIRST so the serialized style contains "var(--panel);"). */
const card = (extra?: CSSProperties): CSSProperties => ({
  background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, ...extra,
});

const FEE_LINE = "10% of profit when you exit — the only fee.";

function SoonChip() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, background: "var(--primary-soft)", color: "var(--primary)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", flex: "none" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />Opens soon
    </span>
  );
}

// Naked stat pair — the tiny caps label carries the structure, no box-in-box.
function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ padding: "8px 4px", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 15, fontWeight: 650, marginTop: 2, color: color ?? "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/** Markdown-lite for the registry's methodology strings: blank-line paragraphs
 *  and **bold** runs. Nothing else, on purpose (same as the public page). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i} style={{ margin: i ? "10px 0 0" : 0, fontSize: 13, lineHeight: 1.65, color: "var(--ink-2)" }}>
          {para.split("**").map((chunk, j) => (j % 2 === 1 ? <b key={j} style={{ color: "var(--ink)", fontWeight: 650 }}>{chunk}</b> : chunk))}
        </p>
      ))}
    </>
  );
}

/** 1Y backtest vs buy-and-hold SPY (dashed) — chat-token colors. */
function BacktestChart({ bt, height = 150 }: { bt: BacktestResult; height?: number }) {
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
      <polygon points={`0,${height} ${plan} ${W},${height}`} fill="var(--primary)" opacity={0.1} />
      <polyline points={pts(bt.benchmark.curve)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
      <polyline points={plan} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function LoadingPanels({ heights }: { heights: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Loading" role="status">
      {heights.map((h, i) => (
        <div key={i} className="glassin" style={card({ height: h, opacity: 0.55, animationDelay: `${i * 0.06}s` })} />
      ))}
    </div>
  );
}

function ErrorNote({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div style={card({ padding: "26px 20px", textAlign: "center" })}>
      <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{text}</div>
      <button onClick={onRetry} style={{ marginTop: 12, height: 38, padding: "0 18px", borderRadius: 999, fontSize: 13, fontWeight: 650, background: "var(--primary)", color: "var(--primary-ink)" }}>Try again</button>
    </div>
  );
}

// ── the shelf ────────────────────────────────────────────────────────────────

// Big square tile: generative cover art (or the registry's raster override) on
// top, then ticker+name, thesis, holdings row, and the stats/fee foot. The
// 1:1 aspect is the preferred size — content can stretch it slightly on narrow
// columns rather than clip.
function GroveShelfCard({ g, onOpen }: { g: GroveLive; onOpen: (id: string) => void }) {
  const top4 = g.components.slice().sort((a, b) => b.weightBps - a.weightBps).slice(0, 4);
  const bt = g.backtest;
  return (
    <button onClick={() => onOpen(g.id)} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, padding: 0, overflow: "hidden", textAlign: "left", display: "flex", flexDirection: "column", aspectRatio: "1 / 1", minWidth: 0, minHeight: 0, contain: "size" }}>
      {/* cover band — the grove's motif under its accent wash */}
      <div style={{ position: "relative", flex: "none", width: "100%", aspectRatio: "2 / 1", borderBottom: "1px solid var(--line-2)" }}>
        <GroveCover id={g.id} coverImage={g.coverImage} />
        {!g.stats.deployed && <span style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}><SoonChip /></span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 7, padding: "12px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
          <span style={{ fontSize: 11.5, fontWeight: 650, color: "var(--primary)", flex: "none" }}>{g.ticker}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{g.thesis}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ display: "inline-flex", flex: "none" }}>
            {top4.map((c, i) => (
              <span key={c.symbol} style={{ display: "inline-flex", marginLeft: i ? -8 : 0, borderRadius: 9, boxShadow: "0 0 0 2px var(--bg)", position: "relative", zIndex: 4 - i }}>
                <AssetTile asset={toTile(c.symbol, c.name)} size={28} radius={9} />
              </span>
            ))}
          </span>
          <span style={{ fontSize: 11, color: "var(--ink-3)", flex: "none" }}>+{g.components.length - top4.length} more</span>
          {bt && (
            <span className="tnum" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 650, color: dcol(bt.portfolio.returnPct), whiteSpace: "nowrap" }}>
              {pctStr(bt.portfolio.returnPct)} 1y<span style={{ color: "var(--ink-3)", fontWeight: 550 }}> · SPY {pctStr(bt.benchmark.returnPct)}</span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8, marginTop: "auto", borderTop: "1px solid var(--line-2)" }}>
          {/* Always shown, zeros included — real numbers arrive with the contract. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tnum" style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-2)" }}>{g.stats.users.toLocaleString("en-US")} investor{g.stats.users === 1 ? "" : "s"} · {usd0(g.stats.managedUsd)} managed</span>
            <PIcon name="ph-caret-right" size={13} weight="bold" style={{ marginLeft: "auto", color: "var(--ink-3)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tnum" style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-2)" }}>min {usd0(g.minBuyUsd)}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>· {FEE_LINE}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function GroveShelf({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, isError, refetch } = useGrovesList();
  if (isLoading) return <LoadingPanels heights={[150, 150, 150, 150]} />;
  if (isError || !data) return <ErrorNote text="Couldn't load the Groves — check your connection and try again." onRetry={() => void refetch()} />;
  // Aggregate strip: honest zeros in preview, live contract reads once deployed.
  const agg = data.groves.reduce(
    (s, g) => ({ users: s.users + g.stats.users, managedUsd: s.managedUsd + g.stats.managedUsd, feesUsd: s.feesUsd + g.stats.feesUsd }),
    { users: 0, managedUsd: 0, feesUsd: 0 },
  );
  const anyDeployed = data.groves.some((g) => g.stats.deployed);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, padding: "2px 2px 14px" }}>
        Curated baskets of real tokenized stocks, bought into your own wallet — non-custodial, every weight public.
        $0 entry, $0 management, $0 rebalancing; the only fee is 10% of profit when you exit.
        From $20 per Grove — small amounts buy the largest holdings first.
      </div>
      <div style={card({ padding: "8px 16px", marginBottom: 14 })}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 4 }}>
          <Stat label="Investors" value={agg.users.toLocaleString("en-US")} sub="across all Groves" />
          <Stat label="Managed" value={usd0(agg.managedUsd)} sub="on-chain cost basis" />
          <Stat label="Fees paid, ever" value={usd0(agg.feesUsd)} sub="10% of realized profit only" />
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.55, padding: "6px 4px 8px", borderTop: "1px solid var(--line-2)" }}>
          {anyDeployed
            ? "Read live from the GroveManager contract — public and verifiable on-chain."
            : "The zeros are honest: these counters read straight from the GroveManager contract, on-chain from day one."}
        </div>
      </div>
      {/* 2-up desktop in the center column, 1-up mobile — big square tiles. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(340px,100%),1fr))", gap: 16 }}>
        {data.groves.map((g) => <GroveShelfCard key={g.id} g={g} onOpen={onOpen} />)}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "center", padding: "16px 8px 4px" }}>
        Backtests are history, not promises · every composition and rule is public at{" "}
        <a href="https://monvera.best/groves" target="_blank" rel="noreferrer" style={{ color: "var(--ink-2)", fontWeight: 600 }}>monvera.best/groves</a>
      </div>
    </div>
  );
}

// ── the detail page ──────────────────────────────────────────────────────────

function GroveDetail({ id, autoManage, nav }: { id: string; autoManage: boolean; nav: ChatNav }) {
  const { data: g, isLoading, isError, refetch } = useGroveLive(id);
  const [autoOpen, setAutoOpen] = useState(autoManage);
  const autoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoOpen) autoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [autoOpen, g]);

  if (isLoading || (!g && !isError)) return <LoadingPanels heights={[190, 90, 230, 300]} />;
  if (isError || !g) return <ErrorNote text="Couldn't load this Grove — check your connection and try again." onRetry={() => void refetch()} />;

  const feePct = g.feeBps / 100;
  const fullUsd = fullDiversificationUsd(g);
  const bt = g.backtest;
  const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 10 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── hero (wide cover band, then the copy) ── */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 22, overflow: "hidden" }}>
        <div style={{ position: "relative", width: "100%", height: "clamp(112px, 20vw, 156px)", borderBottom: "1px solid var(--line-2)" }}>
          <GroveCover id={g.id} coverImage={g.coverImage} />
        </div>
        <div style={{ background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 9%,transparent),transparent 62%)", padding: "18px 22px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary)" }}>{g.ticker}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)", padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>{g.category}</span>
          {!g.stats.deployed && <SoonChip />}
        </div>
        <h1 className="serif" style={{ margin: "8px 0 0", fontSize: 26, fontWeight: 500, letterSpacing: "-.015em" }}>{g.name}</h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)", maxWidth: 640 }}>{g.longThesis}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={() => nav.askVera(`Buy the ${g.name}`)} style={{ flex: "1 1 180px", maxWidth: 280, height: 46, borderRadius: 13, fontSize: 14, fontWeight: 700, background: "linear-gradient(180deg,var(--primary-2),var(--primary))", border: "1px solid color-mix(in srgb,var(--primary) 70%,#000 8%)", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.25)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <PIcon name="ph-sparkle" size={17} /> Buy with Vera
          </button>
          <button onClick={() => (g.stats.deployed ? nav.askVera(`Enable auto-manage for the ${g.name}`) : setAutoOpen(true))} style={{ flex: "1 1 160px", maxWidth: 240, height: 46, borderRadius: 13, fontSize: 13.5, fontWeight: 600, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <PIcon name="ph-arrows-counter-clockwise" size={16} /> Auto-manage
          </button>
        </div>
        <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10 }}>
          Minimum buy {usd0(g.minBuyUsd)} · {FEE_LINE}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 4 }}>
          Small amounts buy the largest holdings first — from {usd0(fullUsd)} every name is included.
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 4 }}>
          Every swap pays the trading venue&rsquo;s spread — under ~$50 it takes a visibly bigger share. {usd0(RECOMMENDED_BUY_USD)}+ recommended.
        </div>
        </div>
      </div>

      {/* ── stats ── */}
      <div style={card({ padding: "8px 16px" })}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 4 }}>
          <Stat label="Investors" value={g.stats.users.toLocaleString("en-US")} sub="open positions" />
          <Stat label="Managed" value={usd0(g.stats.managedUsd)} sub="on-chain cost basis" />
          <Stat label="Fees paid, ever" value={usd0(g.stats.feesUsd)} sub={`${feePct}% of realized profit only`} />
          <Stat label="1y backtest vs SPY" value={bt ? `${pctStr(bt.portfolio.returnPct)} / ${pctStr(bt.benchmark.returnPct)}` : "—"} sub="history, not a promise" color={bt ? dcol(bt.portfolio.returnPct) : undefined} />
        </div>
        {!g.stats.deployed && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.55, padding: "8px 4px 10px", borderTop: "1px solid var(--line-2)" }}>
            <b style={{ color: "var(--ink-2)" }}>This grove has not opened yet.</b> The zeros above are honest: the counters read straight from the GroveManager contract, so they are public and on-chain from day one.
          </div>
        )}
      </div>

      {/* ── auto-manage (gated, honest) ── */}
      {autoOpen && (
        <div ref={autoRef} style={card({ padding: "16px 18px", borderColor: "color-mix(in srgb,var(--primary) 45%,var(--line))" })}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--primary-soft)", color: "var(--primary)", display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-arrows-counter-clockwise" size={16} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Auto-manage</span>
            {!g.stats.deployed && <SoonChip />}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
            {g.stats.deployed
              ? `Vera keeps the basket at its published weights for you — ${g.rebalancePolicy}. Ask her to enable it whenever you're ready.`
              : `Auto-manage opens with the GroveManager contract: Vera will keep the basket at its published weights (${g.rebalancePolicy}), with every action landing on-chain. Until then, buying places the ${g.components.length} names as direct orders into your wallet — they're yours to hold or sell like any other asset, and rebalancing stays in your hands.`}
          </p>
        </div>
      )}

      {/* ── backtest ── */}
      <div style={card({ padding: "16px 18px" })}>
        <div style={sectionTitle}>One year, replayed honestly</div>
        {bt ? (
          <>
            <BacktestChart bt={bt} />
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-2)", fontWeight: 600 }}><span style={{ width: 14, height: 2.5, borderRadius: 2, background: "var(--primary)" }} />{g.ticker}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}><span style={{ width: 14, height: 0, borderTop: "2px dashed var(--ink-3)" }} />S&amp;P 500</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 4, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
              <Stat label={`${g.ticker} · 1y`} value={pctStr(bt.portfolio.returnPct)} color={dcol(bt.portfolio.returnPct)} />
              <Stat label="S&P 500 · same year" value={pctStr(bt.benchmark.returnPct)} />
              <Stat label="Worst dip" value={`−${bt.portfolio.maxDrawdownPct.toFixed(1)}%`} />
              <Stat label="Sharpe" value={bt.portfolio.sharpe.toFixed(2)} />
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 8 }}>
              The basket at today&rsquo;s weights over the last twelve months of real market data, monthly rebalancing, vs buy-and-hold S&amp;P 500. Backtests are history, not promises.
              {bt.coveragePct < 100 && (
                <> This one covers {bt.coveragePct}% of the basket&rsquo;s weight{bt.excluded.length > 0 && <> — {bt.excluded.join(", ")} had no honest public price history, so they were left out rather than faked</>}.</>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
            No backtest to show right now — market history for this basket could not be loaded. We publish nothing rather than an estimate.
          </div>
        )}
      </div>

      {/* ── composition ── */}
      <div style={card({ padding: "16px 18px" })}>
        <div style={sectionTitle}>{g.components.length} holdings, every weight public</div>
        {g.components.map((c, i) => (
          <button key={c.symbol} className="hgl" onClick={() => nav.openCanvas("holding", c.symbol)} style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", padding: "10px 4px", borderTop: i ? "1px solid var(--line-2)" : "none", borderRadius: 10, textAlign: "left" }}>
            <AssetTile asset={toTile(c.symbol, c.name)} size={34} radius={10} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 650, flex: "none" }}>{c.symbol}</span>
                <span style={{ fontSize: 12, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{c.name}</span>
                <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary)", flex: "none" }}>{c.weightBps / 100}%</span>
                <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", flex: "none", minWidth: 62, textAlign: "right" }}>{c.priceUsd != null ? priceStr(c.priceUsd) : "—"}</span>
              </span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 2 }}>{c.reason}</span>
            </span>
          </button>
        ))}
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>Real tokenized stocks at these target weights, priced from the same feeds the app trades on. Tap a name for its chart.</div>
      </div>

      {/* ── methodology ── */}
      <div style={card({ padding: "16px 18px" })}>
        <div style={sectionTitle}>How this basket is built</div>
        {g.id === "tayyib" && (
          <div style={{ background: "var(--primary-soft)", borderRadius: 14, padding: "12px 14px", marginBottom: 12, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink)" }}>
            <b>Screened, not certified.</b> Every name passes our AAOIFI sector and ratio screens, and every exclusion is published with its reason. Formal certification is in progress — until it lands, we will not use the word. A per-holding impure-income estimate is published so holders can purify that sliver.
          </div>
        )}
        <Rich text={g.methodology} />
      </div>

      {/* ── exclusions ── */}
      {g.excluded && g.excluded.length > 0 && (
        <div style={card({ padding: "16px 18px" })}>
          <div style={sectionTitle}>What&rsquo;s not in, and why</div>
          {g.excluded.map((e, i) => (
            <div key={e.symbol} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 2px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, flex: "none", minWidth: 48 }}>{e.symbol}</span>
              <span style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>{e.why}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>Published instead of silently dropped.</div>
        </div>
      )}

      {/* ── fees & mechanics ── */}
      <div style={card({ padding: "16px 18px" })}>
        <div style={sectionTitle}>Every fee, including the zeros</div>
        {([
          ["Entry fee", "$0", true, null],
          ["Management fee", "$0", true, null],
          ["Rebalancing fee", "$0", true, null],
          ["Network fees", "$0", true, "Transactions are sponsored — the network cost is on us."],
          ["Exit fee", `${feePct}% of profit`, false, "Charged only on profit above your own cost basis, only when you exit through the app. Exit flat or at a loss and it is $0."],
        ] as const).map(([name, val, zero, sub], i) => (
          <div key={name} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "9px 2px", borderTop: i ? "1px solid var(--line-2)" : "none" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{name}</span>
              {sub && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 1 }}>{sub}</span>}
            </span>
            <span className="tnum" style={{ fontSize: 13.5, fontWeight: 700, flex: "none", color: zero ? "var(--pos)" : "var(--ink)" }}>{val}</span>
          </div>
        ))}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)", display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            <><b>Your wallet holds every share.</b> Monvera never takes custody — no wrapper token, no pooled fund. See, move, or sell your holdings like any other asset you own.</>,
            <><b>Your own high-water mark.</b> The contract tracks your cost basis per wallet, on-chain. The {feePct}% applies only to gains above everything you put in — never to principal, never twice on the same gain.</>,
            <><b>Venue costs vs Monvera&rsquo;s fee.</b> Every swap pays the trading venue&rsquo;s spread and LP fees — always, priced into the quote you confirm, paid to the market, not to Monvera. Monvera&rsquo;s own fee stays $0 until you exit with a profit. Under ~$50 the venue&rsquo;s share is visibly bigger — {usd0(RECOMMENDED_BUY_USD)}+ recommended.</>,
            <><b>Minimum buy: {usd0(g.minBuyUsd)}.</b> Small amounts buy the largest holdings first — each placed order must clear the venue&rsquo;s ~${MIN_LEG_USD} floor, so below {usd0(fullUsd)} the buy concentrates into the biggest names. From {usd0(fullUsd)} every one of the {g.components.length} names is included.</>,
          ].map((node, i) => (
            <div key={i} style={{ display: "flex", gap: 9, fontSize: 12, lineHeight: 1.6, color: "var(--ink-2)" }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)", flex: "none", marginTop: 6 }} />
              <span>{node}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 10 }}>
          <b style={{ color: "var(--ink-2)" }}>Rebalancing:</b> Vera checks hourly and trades only when needed — this grove is {g.rebalancePolicy}. Every action lands on-chain, where anyone can verify it.
        </div>
      </div>

      {/* ── share ── */}
      <a href={`https://monvera.best/groves/${g.id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, alignSelf: "center", padding: "9px 16px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 12, fontWeight: 600, color: "var(--ink-2)", textDecoration: "none" }}>
        <PIcon name="ph-arrow-square-out" size={14} /> Public page for sharing — monvera.best/groves/{g.id}
      </a>
    </div>
  );
}

// ── the page shell (header + scroll body) ────────────────────────────────────

export function GrovesPage({ groveId, autoManage, nav, onOpen, onBack, mobile = false }: {
  /** Which Grove detail is open, or null for the shelf. */
  groveId: string | null;
  /** Deep-linked auto-manage: open the (gated) auto section on the detail page. */
  autoManage: boolean;
  nav: ChatNav;
  onOpen: (id: string) => void;
  onBack: () => void;
  mobile?: boolean;
}) {
  const def = groveId ? groveById(groveId) : undefined;
  const title = def ? def.name : "Groves";
  const sub = def ? `${def.ticker} · ${def.category}` : "Curated baskets · 10% of profit at exit, the only fee";
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: mobile ? "14px 16px" : "16px 24px", borderBottom: "1px solid var(--line)" }}>
        <button onClick={onBack} aria-label="Back" style={{ width: 36, height: 36, flex: "none", border: "1px solid var(--line)", borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel)", color: "var(--ink-2)" }}>
          <PIcon name="ph-caret-left" size={16} weight="bold" />
        </button>
        <span style={{ width: 40, height: 40, borderRadius: 13, flex: "none", display: "grid", placeItems: "center", background: "linear-gradient(145deg,var(--primary-2),var(--primary))", color: "#fff", boxShadow: "0 6px 14px color-mix(in srgb, var(--primary) 32%, transparent)" }}>
          <PIcon name="ph-tree" size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
        </div>
      </div>
      <main className="scr stag" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? 16 : "22px 28px 48px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          {groveId
            ? <GroveDetail key={groveId} id={groveId} autoManage={autoManage} nav={nav} />
            : <GroveShelf onOpen={onOpen} />}
        </div>
      </main>
    </div>
  );
}
