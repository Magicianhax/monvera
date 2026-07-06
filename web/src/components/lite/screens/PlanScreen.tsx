"use client";

// Plan review — the key trust moment. Faithful re-skin of the design
// (screens_invest.jsx · PlanReview) wired to the REAL allocation returned by
// useInvest.allocate (AllocateResult: summary, rationale, riskScore bps,
// allocations[{symbol, weightPct, reason}]).
//
//   - Vera's note  -> allocation.summary + rationale
//   - allocation bar + named holdings + each one's "why" (reason)
//   - RiskMeter     -> derived from riskScore (bps → 1..5)
//   - Nudge chips   -> re-run allocate() with an adjusted goal/riskTolerance and
//                      visibly rebuild the plan (the "rethinking" state)
//   - big button    -> onInvest() (useInvest.invest → per-leg Arcus quotes + one UserOp)
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Icon, VeraOrb, AssetTile, RiskMeter, VerifiedBadge, Crossfade } from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd } from "@/lib/format";
import type { AllocateResult } from "@/lib/invest-types";
import { iconBtn, Spinner, ThinkingDots } from "./primitives";

gsap.registerPlugin(useGSAP);

type Tone = "balanced" | "safer" | "bolder" | "simple";

const NUDGES: { id: Tone; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "safer", label: "Make it safer" },
  { id: "bolder", label: "Be bolder" },
  { id: "simple", label: "Keep it simple" },
];

// Map a 0..10000 bps risk score to the 1..5 meter + a friendly label.
function riskMeta(bps: number): { level: number; label: string } {
  const v = Math.max(0, Math.min(100, bps / 100));
  if (v < 20) return { level: 1, label: "Very steady" };
  if (v < 40) return { level: 2, label: "Cautious" };
  if (v < 60) return { level: 3, label: "Balanced" };
  if (v < 80) return { level: 4, label: "Adventurous" };
  return { level: 5, label: "Bold" };
}

// Dual equity curve: the proposed mix (accent, filled) vs SPY (dashed). Both
// series arrive normalized to 100, downsampled server-side (lib/server/quant).
function BacktestChart({ bt }: { bt: NonNullable<AllocateResult["backtest"]> }) {
  const W = 300;
  const H = 76;
  const all = [...bt.portfolio.curve, ...bt.benchmark.curve];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pts = (curve: number[]) =>
    curve
      .map((v, i) => `${((i / (curve.length - 1)) * W).toFixed(1)},${(H - 6 - ((v - min) / span) * (H - 12)).toFixed(1)}`)
      .join(" ");
  const planPts = pts(bt.portfolio.curve);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block" }}
      role="img"
      aria-label={`Backtest: this mix ${bt.portfolio.returnPct >= 0 ? "up" : "down"} ${Math.abs(bt.portfolio.returnPct).toFixed(1)}% over 12 months, S&P 500 ${bt.benchmark.returnPct >= 0 ? "up" : "down"} ${Math.abs(bt.benchmark.returnPct).toFixed(1)}%`}
    >
      <polygon
        points={`0,${H} ${planPts} ${W},${H}`}
        fill="var(--accent)"
        opacity={0.1}
      />
      <polyline points={pts(bt.benchmark.curve)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline points={planPts} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BtStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
      {label}{" "}
      <b className="tnum" style={{ color: accent ? "var(--accent)" : "var(--ink)" }}>
        {value >= 0 ? "+" : ""}
        {value.toFixed(1)}%
      </b>
    </span>
  );
}

export function PlanScreen({
  go,
  allocation,
  amount,
  tone,
  rethinking,
  busy,
  onNudge,
  onInvest,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
  allocation: AllocateResult;
  amount: number;
  tone: Tone;
  rethinking: boolean;
  busy: boolean;
  onNudge: (tone: Tone) => void;
  onInvest: () => void;
}) {
  const risk = riskMeta(allocation.riskScore);

  // Identity of the presented plan — the reveal re-runs whenever Vera lands a
  // NEW allocation (after a nudge), not on unrelated re-renders (busy, etc.).
  const planKey = `${allocation.summary}|${allocation.riskScore}|${allocation.allocations
    .map((a) => `${a.symbol}:${a.weightPct}`)
    .join(",")}`;

  // One reveal choreography: Vera's note rises, then each holding fades up
  // while its weight bar grows out of the left edge (the centerpiece), then the
  // risk fill sweeps in and the invest CTA lands last. gsap.from() only — under
  // reduced motion nothing tweens and everything is simply visible.
  const rootRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .from("[data-fx='note']", { y: 14, opacity: 0, duration: 0.32 })
          .addLabel("basket", "-=0.2")
          // rows lead their bars by a beat, same stagger, so each holding's
          // label appears just before its weight draws in
          .from("[data-fx='hrow']", { y: 12, opacity: 0, duration: 0.3, stagger: 0.05 }, "basket")
          .from(
            "[data-fx='wbar']",
            { scaleX: 0, transformOrigin: "left center", duration: 0.5, stagger: 0.05 },
            "basket+=0.08",
          )
          .from("[data-fx='risk']", { y: 12, opacity: 0, duration: 0.3 }, "-=0.3")
          .from(
            "[data-fx='riskfill']",
            { scaleX: 0, transformOrigin: "left center", duration: 0.4 },
            "-=0.22",
          )
          .from("[data-fx='bt']", { y: 12, opacity: 0, duration: 0.3 }, "-=0.2")
          .from("[data-fx='cta']", { y: 12, opacity: 0, duration: 0.28 }, "-=0.24");
      });
      return () => mm.revert();
    },
    { scope: rootRef, dependencies: [planKey], revertOnUpdate: true },
  );

  // While Vera recomposes (a nudge), blur + soften the basket so it reads as one
  // morphing object — transform/filter only, interruptible, GPU-friendly.
  const recompose: React.CSSProperties = {
    filter: rethinking ? "blur(5px)" : "blur(0)",
    opacity: rethinking ? 0.55 : 1,
    transform: rethinking ? "scale(0.99)" : "none",
    transition:
      "filter .34s var(--ease-out), opacity .34s var(--ease-out), transform .34s var(--ease-out)",
  };

  return (
    <div ref={rootRef} className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go("home")} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4 }}>
          <VeraOrb size={26} />
          <h1 className="serif" style={{ margin: 0, fontSize: 21, letterSpacing: "-.01em" }}>Vera&apos;s plan</h1>
        </div>
      </div>

      {/* Vera's note — the message blur-morphs between "rethinking" and the plan,
          so a nudge reads as Vera re-composing one thought (not two states). */}
      <div data-fx="note" style={{ padding: "16px 22px 0" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <VeraOrb size={34} pulse />
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "4px var(--rr) var(--rr) var(--rr)",
              padding: "13px 15px",
              boxShadow: "var(--shadow)",
              fontSize: 15,
              lineHeight: 1.5,
              minHeight: 20,
              flex: 1,
            }}
          >
            <Crossfade
              showFirst={rethinking}
              first={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--ink-2)" }}>
                  <ThinkingDots /> Rethinking your plan…
                </span>
              }
              second={
                <span style={{ display: "block", color: "var(--ink-2)" }}>
                  Here&apos;s what I&apos;d do with{" "}
                  <b className="tnum" style={{ color: "var(--ink)" }}>
                    {usd(amount)}
                  </b>
                  .
                  <b
                    style={{
                      display: "block",
                      color: "var(--ink)",
                      fontWeight: 700,
                      fontSize: 16,
                      letterSpacing: "-.01em",
                      marginTop: 8,
                    }}
                  >
                    {allocation.summary}
                  </b>
                  <span style={{ display: "block", marginTop: 5 }}>{allocation.rationale}</span>
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/* nudge chips — talk back to Vera */}
      <div style={{ display: "flex", gap: 8, padding: "14px 22px 0", overflowX: "auto", flexShrink: 0 }}>
        {NUDGES.map((n) => (
          <button
            key={n.id}
            onClick={() => onNudge(n.id)}
            disabled={rethinking || busy}
            className={`chip tap ${tone === n.id ? "is-on" : ""}`}
            style={{ flex: "none", opacity: rethinking && tone !== n.id ? 0.6 : 1 }}
          >
            {n.label}
          </button>
        ))}
      </div>

      {/* allocation bar — blurs softly while Vera recomposes (one morph, not a grey-out).
          Each segment is a GSAP-owned weight bar (grows scaleX from the left). */}
      <div style={{ ...recompose, padding: "16px 22px 0" }}>
        <div style={{ display: "flex", height: 14, borderRadius: 99, overflow: "hidden", gap: 2 }}>
          {allocation.allocations.map((a) => {
            const tile = toTile(a.symbol);
            return (
              <div
                key={a.symbol}
                data-fx="wbar"
                style={{ width: `${a.weightPct}%`, background: tile.color }}
                title={tile.name}
              />
            );
          })}
        </div>
      </div>

      {/* holdings — GSAP fade-rises each card (was the CSS .stagger class) */}
      <div style={{ ...recompose, padding: "16px 22px 0" }}>
        {allocation.allocations.map((a) => {
          const tile = toTile(a.symbol);
          const dollars = (amount * a.weightPct) / 100;
          return (
            <div key={a.symbol} data-fx="hrow" className="card" style={{ padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <AssetTile asset={tile} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: 16.5 }}>{tile.name}</span>
                    <span className="tnum" style={{ fontWeight: 700, fontSize: 16 }}>
                      {usd(dollars)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 1 }}>
                    <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{catFor(a.symbol)}</span>
                    <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 }}>
                      {Math.round(a.weightPct)}%
                    </span>
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 13.5,
                  color: "var(--ink-2)",
                  marginTop: 10,
                  lineHeight: 1.45,
                  display: "flex",
                  gap: 7,
                }}
              >
                <Icon name="info" size={15} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
                {a.reason}
              </div>
            </div>
          );
        })}
      </div>

      {/* risk */}
      <div style={{ ...recompose, padding: "6px 22px 0" }}>
        <div data-fx="risk" className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>
              How bumpy this could feel
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>{risk.label}</span>
          </div>
          {/* wrapper (not RiskMeter's own segments — they carry CSS transitions)
              so GSAP can grow the fill from the left without a transition fight */}
          <div data-fx="riskfill">
            <RiskMeter level={risk.level} />
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Some ups and downs are normal. Stocks can go down too, so only invest what you can leave
            for a while.
          </p>
        </div>
      </div>

      {/* backtest — how this exact mix actually behaved over the last year */}
      {allocation.backtest && (
        <div style={{ ...recompose, padding: "10px 22px 0" }}>
          <div data-fx="bt" className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>
                How this mix held up
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>last 12 months</span>
            </div>
            <BacktestChart bt={allocation.backtest} />
            <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
              <BtStat label="This mix" value={allocation.backtest.portfolio.returnPct} accent />
              <BtStat label="S&P 500" value={allocation.backtest.benchmark.returnPct} />
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                Worst dip{" "}
                <b className="tnum" style={{ color: "var(--ink)" }}>
                  −{allocation.backtest.portfolio.maxDrawdownPct.toFixed(1)}%
                </b>
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
              {allocation.backtest.coveragePct < 100 &&
                `Covers ${Math.round(allocation.backtest.coveragePct)}% of the mix (${allocation.backtest.excluded.join(", ")} ${allocation.backtest.excluded.length === 1 ? "has" : "have"} no public history yet). `}
              Rebalanced monthly. History, not a promise: markets change.
            </p>
          </div>
        </div>
      )}

      {/* trust line */}
      <div style={{ padding: "14px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Vera will sign & record this plan" onClick={() => go("vera")} />
      </div>

      {/* Pinned invest bar — sticky (NOT absolute, which scrolls inside an
          overflow container). margin-top:auto holds it at the bottom on short
          content; sticky bottom:0 keeps it fixed while the plan scrolls behind. */}
      <div
        data-fx="cta"
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
        }}
      >
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-2)", marginBottom: 10 }}>
          Price includes the quoted spread · gas on us
        </div>
        <button className="btn btn-primary btn-block btn-lg tap" disabled={rethinking || busy} onClick={onInvest}>
          <Crossfade
            showFirst={busy && !rethinking}
            style={{ alignItems: "center" }}
            first={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <Spinner small /> Securing…
              </span>
            }
            second={<span>Invest {usd(amount)}</span>}
          />
        </button>
      </div>
    </div>
  );
}
