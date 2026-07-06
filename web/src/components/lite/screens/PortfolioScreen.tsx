"use client";

// Portfolio — Ledger layout: centered focal stat block up top, a horizontal
// segmented allocation bar with flat hairline legend rows (the donut is gone),
// and an edge-to-edge holdings ledger. Wired to REAL data: holdings + USD
// values from usePortfolio, cash from useUsdcBalance (via /api/portfolio).
//
// Note on P&L: we don't track cost basis on-chain, so we DON'T fabricate an
// "all time" gain. The stat block shows the real invested total; per-holding
// rows show approximate current value.
import { useState, type ReactNode } from "react";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, VeraOrb, CountUp, HoldingRow, VerifiedBadge, PriceChart, AssetTile, Donut } from "@/components/design";
import { haptic } from "@/lib/haptics";
import { displayFor, toTile } from "@/lib/displayAssets";
import { usd, tokenQty } from "@/lib/format";
import { portfolioDayCurve } from "@/lib/portfolioCurve";
import { usePortfolioHistory } from "@/hooks/usePortfolioHistory";
import { useMarketHistory, type MarketRange } from "@/hooks/useMarket";
import { boxHead, innerBox } from "./primitives";

// Time ranges for the portfolio value chart + the "move" label they read as.
const PORT_RANGES: { label: string; key: MarketRange; moveWord: string }[] = [
  { label: "1D", key: "1D", moveWord: "today" },
  { label: "1W", key: "1W", moveWord: "past week" },
  { label: "1M", key: "1M", moveWord: "past month" },
  { label: "1Y", key: "1Y", moveWord: "past year" },
  { label: "All", key: "All", moveWord: "all time" },
];

// Ledger section header — strong sans, sits in the 22px gutter with generous
// top spacing. Optional right-hand meta (e.g. positions count).
function LedgerHeader({ children, right, tight }: { children: ReactNode; right?: ReactNode; tight?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: `${tight ? 14 : 28}px 22px 10px`,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

export function PortfolioScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  // Cash, invested, and total all arrive pre-computed from /api/portfolio —
  // this screen renders them verbatim (no client-side money math).
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);

  const cash = port?.cashUsd ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  // Only holdings we could price contribute to the allocation bar/legend share;
  // largest first so segments and legend read big → small ("+N more" hides the tail).
  const priced = holdings
    .filter((h) => h.valueUsd !== undefined && h.valueUsd > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const total = port?.totalUsd ?? 0;

  // (Allocation now uses the self-animating Donut; its old GSAP bar reveal is gone.)

  // ── First-load skeleton — don't flash the empty state before holdings resolve.
  if (portLoading && holdings.length === 0) {
    return (
      <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
        <div style={{ padding: "12px 22px 0" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>
            Portfolio
          </h1>
          {/* mirrors the centered stat block: eyebrow, big number, day move, meta */}
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="skeleton" style={{ width: 72, height: 11, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: 150, height: 32, borderRadius: 5, marginTop: 10 }} />
            <div className="skeleton" style={{ width: 130, height: 12, borderRadius: 4, marginTop: 8 }} />
            <div className="skeleton" style={{ width: 180, height: 12, borderRadius: 4, marginTop: 8 }} />
          </div>
        </div>
        {/* allocation bar skeleton */}
        <div style={{ padding: "28px 22px 0" }}>
          <div className="skeleton" style={{ width: 76, height: 13, borderRadius: 4, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: "100%", height: 14, borderRadius: 4 }} />
        </div>
        {/* holdings ledger skeleton — edge to edge, hairline rows */}
        <div
          style={{
            marginTop: 28,
            borderTop: "1px solid var(--line)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "14px 22px",
                borderBottom: i < 2 ? "1px solid var(--line-2)" : "none",
              }}
            >
              <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 5, flex: "none" }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: "55%", height: 13, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: "34%", height: 11, borderRadius: 4, marginTop: 8 }} />
              </div>
              <div className="skeleton" style={{ width: 56, height: 16, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state — flat panel, centered focal content, both actions kept ───
  if (holdings.length === 0) {
    return (
      <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
        <div style={{ padding: "12px 22px 0" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>
            Portfolio
          </h1>
        </div>
        <div style={{ padding: "24px 22px 0" }}>
          <div className="card anim-rise" style={{ padding: 22, textAlign: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 6,
                background: "var(--surface-2)",
                display: "grid",
                placeItems: "center",
                color: "var(--ink-3)",
                margin: "0 auto 16px",
              }}
            >
              <Icon name="trend" size={28} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em", margin: "0 0 6px" }}>
              Nothing owned yet
            </h2>
            <p style={{ fontSize: 14.5, color: "var(--ink-2)", margin: "0 0 20px", lineHeight: 1.5 }}>
              When you invest, the companies and funds you own will show up here.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary tap" onClick={() => go("goal")}>
                <VeraOrb size={24} /> Start with Vera
              </button>
              <button className="btn btn-ghost tap" onClick={() => go("market")}>
                Browse the market
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const allocTotal = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0) || 1;

  // Portfolio insights (today snapshot) from data we already have.
  const withDay = priced.filter((h) => h.dayChangePct !== undefined && Number.isFinite(h.dayChangePct));
  const best = withDay.length ? withDay.reduce((a, b) => ((b.dayChangePct ?? 0) > (a.dayChangePct ?? 0) ? b : a)) : null;
  const worst = withDay.length ? withDay.reduce((a, b) => ((b.dayChangePct ?? 0) < (a.dayChangePct ?? 0) ? b : a)) : null;
  const biggest = priced.length ? priced.reduce((a, b) => ((b.valueUsd ?? 0) > (a.valueUsd ?? 0) ? b : a)) : null;
  const concentration = biggest ? Math.round(((biggest.valueUsd ?? 0) / allocTotal) * 100) : 0;

  // Value chart with time ranges. 1D uses the instant spark-based curve; longer
  // ranges fetch each holding's history and combine (usePortfolioHistory). The
  // fetched curve wins when it arrives, so 1D shows instantly then refines.
  const [rangeIdx, setRangeIdx] = useState(0);
  const range = PORT_RANGES[rangeIdx];
  const { data: rangeCurve } = usePortfolioHistory(
    holdings.map((h) => ({ symbol: h.asset.symbol, valueUsd: h.valueUsd })),
    cash,
    range.key,
  );
  const dayCurve = portfolioDayCurve([...holdings, { valueUsd: cash }]);
  const day = rangeCurve ?? (rangeIdx === 0 ? dayCurve : null);
  // Benchmark: the S&P 500 (SPY) over the same range, to show if you beat it.
  const { data: spyHist } = useMarketHistory("SPY", range.key);
  const spyPct = spyHist?.changePct;

  // Chart scrub: while the finger is down, the hero reads the value at that point.
  const [scrub, setScrub] = useState<{ price: number; index: number } | null>(null);
  const heroValue = scrub ? scrub.price : total;
  // The move shown: over the range, or from range-open to the scrub point.
  const moveUsd = day ? (scrub ? scrub.price - day.curve[0] : day.changeUsd) : 0;
  const movePct = day && day.curve[0] > 0 ? (moveUsd / day.curve[0]) * 100 : 0;
  const moveUp = moveUsd >= 0;

  // Tap-to-reveal: which allocation segment is selected (null = none).
  const [allocPick, setAllocPick] = useState<string | null>(null);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* ── Portfolio hero — open (no card): total value + today's move over a
          full-bleed value chart, then a plain Holdings/Cash row. ── */}
      <div style={{ padding: "12px 22px 0" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>
          Portfolio
        </h1>
      </div>
      <div className="anim-rise">
        {/* value + today's move (honest: market movement of what you own today,
            not cost-basis profit — we don't track what you paid). */}
        <div style={{ padding: "16px 22px 0", textAlign: "center" }}>
          <div className="label-eyebrow">Total value</div>
          <div className="tnum" style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-.03em", marginTop: 3 }}>
            {scrub ? usd(heroValue) : <CountUp to={heroValue} />}
          </div>
          {day && (
            <div style={{ marginTop: 8 }}>
              <span
                className="tnum"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "5px 11px",
                  borderRadius: 999,
                  color: moveUp ? "var(--pos)" : "var(--neg)",
                  background: moveUp
                    ? "color-mix(in srgb, var(--pos) 13%, transparent)"
                    : "color-mix(in srgb, var(--neg) 13%, transparent)",
                }}
              >
                <span aria-hidden>{moveUp ? "▲" : "▼"}</span>
                {`${usd(Math.abs(moveUsd))} · ${Math.abs(movePct).toFixed(2)}% ${range.moveWord}`}
              </span>
            </div>
          )}
        </div>

        {/* value curve — full-bleed, scrubbable (drag to read the value) */}
        {day && day.curve.length > 1 && (
          <div style={{ marginTop: 14 }}>
            <PriceChart
              data={day.curve}
              up={day.changeUsd >= 0}
              height={128}
              raw
              onScrub={setScrub}
              label={`Portfolio value ${range.moveWord}, ${day.changeUsd >= 0 ? "up" : "down"} ${Math.abs(day.changePct).toFixed(1)}%. Touch and drag to read the value at any time.`}
            />
          </div>
        )}

        {/* time-range chips */}
        <div style={{ display: "flex", gap: 8, padding: "12px 22px 0", justifyContent: "center" }}>
          {PORT_RANGES.map((r, i) => (
            <button
              key={r.key}
              onClick={() => {
                setRangeIdx(i);
                setScrub(null);
              }}
              className={`chip tap ${rangeIdx === i ? "is-on" : ""}`}
              aria-pressed={rangeIdx === i}
              style={{ flex: "none", height: 32, fontSize: 12.5, fontWeight: 600, padding: "0 12px" }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* vs S&P 500 — did you beat the market over this range? */}
        {day && spyPct !== undefined && spyPct !== null && !scrub && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "12px 22px 0", fontSize: 12.5 }}>
            {(() => {
              const beat = day.changePct >= spyPct;
              return (
                <>
                  <span
                    className="tnum"
                    style={{
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 999,
                      color: beat ? "var(--pos)" : "var(--neg)",
                      background: beat
                        ? "color-mix(in srgb, var(--pos) 12%, transparent)"
                        : "color-mix(in srgb, var(--neg) 12%, transparent)",
                    }}
                  >
                    {beat ? "Beating" : "Trailing"} the S&P 500
                  </span>
                  <span className="tnum" style={{ color: "var(--ink-3)" }}>
                    You {day.changePct >= 0 ? "+" : ""}{day.changePct.toFixed(1)}% · S&P {spyPct >= 0 ? "+" : ""}{spyPct.toFixed(1)}%
                  </span>
                </>
              );
            })()}
          </div>
        )}

        {/* Holdings / Cash — plain row in the gutter, no box */}
        <div style={{ display: "flex", gap: 22, padding: "16px 22px 0", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div className="label-eyebrow">Holdings</div>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{usd(invested)}</div>
          </div>
          <div style={{ width: 1, background: "var(--line-2)", alignSelf: "stretch" }} />
          <div style={{ textAlign: "center" }}>
            <div className="label-eyebrow">Cash</div>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{usd(cash)}</div>
          </div>
        </div>
      </div>

      {/* ── Allocation — segmented bar in the gutter, legend as hairline rows ── */}
      <LedgerHeader
        right={
          <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)" }}>
            {priced.length} held
          </span>
        }
      >
        Allocation
      </LedgerHeader>
      {/* Interactive donut — tap a slice to focus it; the center reads the pick. */}
      <div style={{ display: "flex", justifyContent: "center", padding: "6px 22px 0" }}>
        {priced.length > 0 ? (
          (() => {
            const pickIdx = allocPick ? priced.findIndex((h) => h.asset.symbol === allocPick) : -1;
            const pick = pickIdx >= 0 ? priced[pickIdx] : null;
            const pd = pick ? displayFor(pick.asset.symbol, pick.asset.name) : null;
            return (
              <Donut
                size={168}
                thickness={22}
                segments={priced.map((h) => ({ value: h.valueUsd ?? 0, color: displayFor(h.asset.symbol, h.asset.name).color }))}
                activeIndex={pickIdx >= 0 ? pickIdx : null}
                onSegmentClick={(i) => {
                  haptic.select();
                  const sym = priced[i].asset.symbol;
                  setAllocPick((cur) => (cur === sym ? null : sym));
                }}
                center={
                  pick && pd ? (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
                        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: pd.color }} />
                        {pd.ticker ?? pick.asset.symbol}
                      </div>
                      <div className="tnum" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", marginTop: 1 }}>
                        {Math.round(((pick.valueUsd ?? 0) / allocTotal) * 100)}%
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      <div className="tnum" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>{priced.length}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600, marginTop: 1 }}>
                        {priced.length === 1 ? "holding" : "holdings"}
                      </div>
                    </div>
                  )
                }
              />
            );
          })()
        ) : (
          <div style={{ width: 168, height: 168, borderRadius: "50%", border: "22px solid var(--surface-2)" }} />
        )}
      </div>

      {/* ── Insights — today's best/worst + concentration (from real day data) ── */}
      {withDay.length > 0 && best && worst && biggest && (
        <section style={{ padding: "18px 22px 0" }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Insights</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(
                [
                  { key: "best", label: "Best today", h: best, val: `${(best.dayChangePct ?? 0) >= 0 ? "+" : ""}${(best.dayChangePct ?? 0).toFixed(2)}%`, color: "var(--pos)" },
                  { key: "worst", label: "Worst today", h: worst, val: `${(worst.dayChangePct ?? 0) >= 0 ? "+" : ""}${(worst.dayChangePct ?? 0).toFixed(2)}%`, color: (worst.dayChangePct ?? 0) >= 0 ? "var(--pos)" : "var(--neg)" },
                  { key: "big", label: "Biggest position", h: biggest, val: `${concentration}%`, color: "var(--ink-2)" },
                ] as const
              )
                // "worst" is redundant when there's only one holding (best === worst).
                .filter((row) => !(row.key === "worst" && best === worst))
                .map((row) => (
                  <div
                    key={row.key}
                    className="tap"
                    onClick={() => go("asset", { symbol: row.h.asset.symbol })}
                    style={{ ...innerBox, cursor: "pointer" }}
                  >
                    <AssetTile asset={toTile(row.h.asset.symbol, row.h.asset.name)} size={34} radius={11} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>{row.label}</div>
                      <div style={{ fontWeight: 600, fontSize: 14.5, marginTop: 1 }}>
                        {displayFor(row.h.asset.symbol, row.h.asset.name).name}
                      </div>
                    </div>
                    <span className="tnum" style={{ fontWeight: 700, fontSize: 15, color: row.color }}>{row.val}</span>
                  </div>
                ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Holdings — one outer box, each row a mini box inside ── */}
      <section style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ ...boxHead }}>Holdings</div>
          <div className="stagger-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {holdings.map((h) => {
          const base = toTile(h.asset.symbol, h.asset.name);
          // Real 1D market data (from the server) replaces the presentational
          // tint whenever the asset has a live source.
          const tile = {
            ...base,
            day: h.dayChangePct ?? base.day,
            spark: h.spark ?? base.spark,
          };
          const day = h.dayChangePct;
          return (
            <div
              key={h.asset.symbol}
              style={{
                // HoldingRow carries its own padding; the inner box adds the tint.
                padding: "2px 8px",
                background: "var(--glass-bg-2)",
                borderRadius: "var(--r-lg)",
              }}
            >
              <HoldingRow
                asset={tile}
                sub={`${tokenQty(h.raw, h.asset.decimals ?? 18)} ${h.asset.symbol}`}
                showSpark
                onClick={() => go("asset", { symbol: h.asset.symbol })}
                right={
                  <div className="tnum" style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>
                      {h.valueUsd !== undefined
                        ? usd(h.valueUsd)
                        : tokenQty(h.raw, h.asset.decimals ?? 18)}
                    </div>
                    {day !== undefined && (
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          marginTop: 2,
                          color: day >= 0 ? "var(--pos)" : "var(--neg)",
                        }}
                      >
                        {(day >= 0 ? "+" : "") + day.toFixed(2)}% today
                      </div>
                    )}
                  </div>
                }
              />
            </div>
          );
        })}
          </div>
        </div>
      </section>

      {/* centered trust footer — standalone badge is a focal moment */}
      <div style={{ padding: "20px 22px 0", textAlign: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
      </div>
    </div>
  );
}
