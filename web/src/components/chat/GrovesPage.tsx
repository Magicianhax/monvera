"use client";

// Groves — FULL PAGES inside the Vera app (the "Monvera Chat" design language),
// desktop center takeover + mobile sheet. The shelf lists every Grove; the
// detail lives in GroveDetailView, with buy and exit as in-page panels.
// Data comes from the public /api/groves endpoints (same registry + live layer
// as the site pages — no duplicate logic).
//
// Buy and exit go STRAIGHT TO THE CONTRACT here. They deliberately no longer
// hand off to chat: a chat plan places per-leg market buys, which would leave
// the user holding the right tokens with no position in GroveManager — no
// on-chain cost basis, and no way to exit through the Grove.
//
// Glass idiom: panels MUST inline `background: "var(--panel)"` first so the
// CHAT_THEME_CSS highlight selector bites. These are public numbers — the
// hidden-balances privacy rule does not apply here.
import { useState } from "react";
import type { CSSProperties } from "react";
import { groveById } from "@/lib/groves";
import { useGrovesList, useGroveLive, type GroveLive } from "@/hooks/useGroves";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { GroveCover } from "@/components/GroveCover";
import { GroveBuyPanel } from "./GroveBuyPanel";
import { GroveExitPanel } from "./GroveExitPanel";
import { GroveDetailView } from "./GroveDetailView";
import { useGrovePosition } from "@/hooks/useGrovePosition";
import { useSmartAccountAddress } from "@/hooks/useSmartAccountAddress";
import { PIcon, usd0, pctStr, dcol, type ChatNav } from "./chatKit";

// ── shared bits ──────────────────────────────────────────────────────────────

/** Plain glass card (background FIRST so the serialized style contains "var(--panel);"). */
const card = (extra?: CSSProperties): CSSProperties => ({
  background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, ...extra,
});

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

function LoadingPanels({ heights }: { heights: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Loading" role="status">
      {heights.map((h, i) => (
        <div key={i} className="glassin" style={card({ height: h, opacity: 0.55, animationDelay: `${i * 0.06}s` })} />
      ))}
    </div>
  );
}

// Shelf skeleton that mirrors the LOADED layout exactly — intro line, stats
// band, then the same 2-up grid of tall cover cards — so nothing jumps when
// the data lands.
function ShelfSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }} aria-label="Loading" role="status">
      <div style={{ padding: "2px 2px 14px" }}>
        <div className="glassin" style={{ height: 13, width: "92%", borderRadius: 7, opacity: 0.4 }} />
        <div className="glassin" style={{ height: 13, width: "70%", borderRadius: 7, opacity: 0.4, marginTop: 8 }} />
      </div>
      <div className="glassin" style={card({ height: 92, opacity: 0.55, marginBottom: 14 })} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(340px,100%),1fr))", gap: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glassin" style={card({ overflow: "hidden", opacity: 0.55, animationDelay: `${i * 0.07}s`, padding: 0 })}>
            <div style={{ aspectRatio: "2 / 1", background: "var(--panel-2)" }} />
            <div style={{ padding: "14px 16px 18px" }}>
              <div style={{ height: 11, width: 90, borderRadius: 6, background: "var(--panel-2)" }} />
              <div style={{ height: 18, width: "60%", borderRadius: 8, background: "var(--panel-2)", marginTop: 10 }} />
              <div style={{ height: 12, width: "88%", borderRadius: 6, background: "var(--panel-2)", marginTop: 10 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} style={{ height: 26, borderRadius: 8, background: "var(--panel-2)" }} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
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
    // Height follows content — text is never allowed to clip; the wide 2:1
    // cover carries the size, so the tile reads near-square on the 2-up grid.
    <div style={{ position: "relative", minWidth: 0, borderRadius: 20, overflow: "hidden", border: "1px solid var(--line)", background: "var(--panel)" }}>
    <button onClick={() => onOpen(g.id)} style={{ padding: 0, border: 0, background: "transparent", textAlign: "left", display: "flex", flexDirection: "column", minWidth: 0, width: "100%" }}>
      {/* cover band — the grove's motif under its accent wash */}
      <div style={{ position: "relative", flex: "none", width: "100%", aspectRatio: "2 / 1", overflow: "hidden", borderBottom: "1px solid var(--line-2)" }}>
        <GroveCover id={g.id} coverImage={g.coverImage} />
        {!g.stats.deployed && <span style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}><SoonChip /></span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 7, padding: "12px 16px 14px" }}>
        {/* Fixed rows are flex:none so the square's compression lands on the gaps,
            never on text. */}
        {/* Structured like the public card: ticker+chip, big serif name, thesis,
            logos, a labeled 4-stat grid, then the mono foot line. */}
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="tnum" style={{ fontSize: 13, fontWeight: 750, letterSpacing: ".02em", color: "var(--primary)" }}>{g.ticker}</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", flex: "none" }}>{g.category}</span>
        </div>
        <div className="serif" style={{ flex: "none", fontSize: 20, fontWeight: 600, letterSpacing: "-.015em", color: "var(--ink)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
        <div style={{ flex: "none", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{g.thesis}</div>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ display: "inline-flex", flex: "none" }}>
            {top4.map((c, i) => (
              <span key={c.symbol} style={{ display: "inline-flex", marginLeft: i ? -8 : 0, borderRadius: 9, boxShadow: "0 0 0 2px var(--bg)", position: "relative", zIndex: 4 - i }}>
                <AssetTile asset={toTile(c.symbol, c.name)} size={28} radius={9} />
              </span>
            ))}
          </span>
          <span style={{ fontSize: 11, color: "var(--ink-3)", flex: "none" }}>+{g.components.length - top4.length} more</span>
        </div>
        <div style={{ flex: "none", display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, paddingTop: 10, marginTop: "auto", borderTop: "1px solid var(--line-2)" }}>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>1y backtest</div>
            <div className="tnum" style={{ fontSize: 14, fontWeight: 700, marginTop: 1, color: bt ? dcol(bt.portfolio.returnPct) : "var(--ink-3)" }}>{bt ? pctStr(bt.portfolio.returnPct) : "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>S&P · same yr</div>
            <div className="tnum" style={{ fontSize: 14, fontWeight: 700, marginTop: 1, color: "var(--ink-2)" }}>{bt ? pctStr(bt.benchmark.returnPct) : "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>Min buy</div>
            <div className="tnum" style={{ fontSize: 14, fontWeight: 700, marginTop: 1, color: "var(--ink)" }}>{usd0(g.minBuyUsd)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>Investors</div>
            <div className="tnum" style={{ fontSize: 14, fontWeight: 700, marginTop: 1, color: "var(--ink)" }}>{g.stats.users.toLocaleString("en-US")} <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>· {usd0(g.stats.managedUsd)}</span></div>
          </div>
        </div>
        </div>
    </button>
    </div>
  );
}

function GroveShelf({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, isError, refetch } = useGrovesList();
  if (isLoading) return <ShelfSkeleton />;
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

// Buy and exit now happen in-page against the contract, so this no longer needs
// `nav` to hand off to chat — the props stay for the caller's signature.
function GroveDetail({ id, autoManage }: { id: string; autoManage: boolean; nav: ChatNav }) {
  const { data: g, isLoading, isError, refetch } = useGroveLive(id);
  // Buy and exit are POPUPS (PaySheet idiom): fixed-position modals, so no
  // scroll-into-view choreography and the page never reflows under them.
  const [buyOpen, setBuyOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const { data: position } = useGrovePosition(g?.onChainId);
  const smartAccount = useSmartAccountAddress();

  if (isLoading || (!g && !isError)) return <LoadingPanels heights={[190, 120, 260, 200]} />;
  // Only when there is NOTHING to show. A failed background refetch keeps the
  // cached grove; tearing the page down then would also unmount an open modal
  // mid-transaction, abandoning a signature already in flight.
  if (!g) return <ErrorNote text="Couldn't load this Grove — check your connection and try again." onRetry={() => void refetch()} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GroveDetailView
        g={g}
        position={position}
        smartAccount={smartAccount}
        onBuy={() => setBuyOpen(true)}
        onExit={() => setExitOpen(true)}
        autoFocus={autoManage}
      />

      {buyOpen && g.onChainId !== undefined && <GroveBuyPanel g={g} onClose={() => setBuyOpen(false)} />}
      {exitOpen && position?.open && <GroveExitPanel g={g} onClose={() => setExitOpen(false)} />}

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
  const sub = def ? `${def.ticker} · ${def.category}` : "Curated baskets, straight into your wallet";
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
