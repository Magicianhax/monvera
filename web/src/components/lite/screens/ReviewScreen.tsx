"use client";

// Portfolio Review — Vera assesses what the user actually holds, the same way
// she assesses a plan: concentration, theme overlap, the mix's own 12-month
// history vs SPY, and at most three optional nudges. All numbers come computed
// from the server (lib/server/portfolioReview); the screen only renders them.
// Nudges are proposals: their CTAs route into the normal ask-Vera flow, never
// a direct trade.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { authHeader } from "@/lib/authedFetch";
import { Icon, VeraOrb } from "@/components/design";
import { iconBtn, Spinner } from "./primitives";

// Client-side mirror of the route's response (server type is server-only).
interface ReviewSeries {
  returnPct: number;
  volPct: number;
  maxDrawdownPct: number;
  curve: number[];
}
interface Review {
  concentration: { topSymbol: string; topWeightPct: number; top3WeightPct: number; holdingsCount: number };
  themes: { theme: string; symbols: string[]; weightPct: number }[];
  backtest: { coveragePct: number; excluded: string[]; portfolio: ReviewSeries; benchmark: ReviewSeries } | null;
  narrative: {
    verdict: string;
    observations: string[];
    nudges: { title: string; detail: string; kind: "diversify" | "trim" | "steady" | "none" }[];
  };
}

const NUDGE_ICON: Record<string, string> = { diversify: "grid", trim: "trend", steady: "shield", none: "check" };

function CurveChart({ bt }: { bt: NonNullable<Review["backtest"]> }) {
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
  const mixPts = pts(bt.portfolio.curve);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block" }}
      role="img"
      aria-label={`This mix ${bt.portfolio.returnPct >= 0 ? "up" : "down"} ${Math.abs(bt.portfolio.returnPct).toFixed(1)}% over 12 months, S&P 500 ${bt.benchmark.returnPct >= 0 ? "up" : "down"} ${Math.abs(bt.benchmark.returnPct).toFixed(1)}%`}
    >
      <polygon points={`0,${H} ${mixPts} ${W},${H}`} fill="var(--accent)" opacity={0.1} />
      <polyline points={pts(bt.benchmark.curve)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline points={mixPts} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// `signed` shows a leading + on positives — right for a RETURN (a gain), wrong
// for a share like concentration, where "+71.6%" reads as a profit.
function Stat({
  label,
  value,
  suffix = "%",
  signed = false,
}: {
  label: string;
  value: number;
  suffix?: string;
  signed?: boolean;
}) {
  return (
    <div style={{ flex: 1, minWidth: 90 }}>
      <div className="tnum" style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-.02em" }}>
        {signed && value > 0 ? "+" : ""}
        {value.toFixed(1)}
        {suffix}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</div>
    </div>
  );
}

export function ReviewScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);

  const run = useCallback(async () => {
    setError(null);
    setReview(null);
    const holdings = (port?.holdings ?? [])
      .filter((h) => (h.valueUsd ?? 0) > 0)
      .map((h) => ({ symbol: h.asset.symbol, weightPct: h.valueUsd as number }));
    if (holdings.length === 0) {
      setError("Nothing to review yet. Buy something first, then come back.");
      return;
    }
    try {
      const res = await fetch("/api/portfolio-review", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ holdings }),
      });
      const json = (await res.json()) as Review & { error?: string };
      if (!res.ok) throw new Error(json.error || "Vera couldn't finish the review. Try again.");
      setReview(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vera couldn't finish the review. Try again.");
    }
  }, [port]);

  // Kick off once the portfolio is loaded; a re-tap re-runs it.
  useEffect(() => {
    if (!port || requested.current) return;
    requested.current = true;
    void run();
  }, [port, run]);

  const busy = !review && !error;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h2 className="title-sm" style={{ margin: 0 }}>
          Portfolio review
        </h2>
      </div>

      {busy && (
        <div className="anim-rise" style={{ padding: "48px 22px", textAlign: "center" }}>
          <VeraOrb size={54} />
          <div style={{ marginTop: 16, fontSize: 14.5, color: "var(--ink-2)", display: "inline-flex", gap: 9, alignItems: "center" }}>
            <Spinner small /> Vera is reading your holdings…
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 8 }}>
            Real numbers first, words second. Takes a few seconds.
          </p>
        </div>
      )}

      {error && (
        <div style={{ padding: "24px 22px" }}>
          <div className="card" style={{ padding: 18 }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>{error}</p>
            <button className="btn btn-glass tap" style={{ marginTop: 14 }} onClick={() => void run()}>
              Try again
            </button>
          </div>
        </div>
      )}

      {review && (
        <>
          {/* Verdict */}
          <div className="anim-rise" style={{ padding: "22px 22px 0" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <VeraOrb size={34} />
              <p style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-.015em", lineHeight: 1.4 }}>
                {review.narrative.verdict}
              </p>
            </div>
          </div>

          {/* Concentration */}
          <div style={{ padding: "18px 22px 0" }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 10 }}>
                How concentrated you are
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Stat label={`largest (${review.concentration.topSymbol})`} value={review.concentration.topWeightPct} />
                <Stat label="top three together" value={review.concentration.top3WeightPct} />
                <Stat label="positions" value={review.concentration.holdingsCount} suffix="" />
              </div>
            </div>
          </div>

          {/* Theme overlap */}
          {review.themes.length > 0 && (
            <div style={{ padding: "12px 22px 0" }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 10 }}>
                  Ideas that move together
                </div>
                {review.themes.map((t) => (
                  <div key={t.theme} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", gap: 12 }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>{t.theme}</span>
                      <span style={{ fontSize: 12.5, color: "var(--ink-3)", marginLeft: 8 }}>{t.symbols.join(" · ")}</span>
                    </div>
                    <span className="tnum" style={{ fontSize: 14, fontWeight: 650 }}>
                      {t.weightPct.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Backtest */}
          {review.backtest && (
            <div style={{ padding: "12px 22px 0" }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 10 }}>
                  This mix&apos;s last 12 months, next to the S&amp;P 500
                </div>
                <CurveChart bt={review.backtest} />
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                  <Stat label="this mix" value={review.backtest.portfolio.returnPct} signed />
                  <Stat label="S&P 500" value={review.backtest.benchmark.returnPct} signed />
                  <Stat label="worst dip" value={-Math.abs(review.backtest.portfolio.maxDrawdownPct)} />
                </div>
                <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
                  This is the mix&apos;s own history, not your return, and history is not a promise.
                  {review.backtest.excluded.length > 0 && ` Left out (no public history): ${review.backtest.excluded.join(", ")}.`}
                </p>
              </div>
            </div>
          )}

          {/* Observations */}
          {review.narrative.observations.length > 0 && (
            <div style={{ padding: "12px 22px 0" }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>
                  What Vera noticed
                </div>
                {review.narrative.observations.map((o, i) => (
                  <p key={i} style={{ margin: "0 0 8px", fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>
                    {o}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Nudges — proposals only */}
          {review.narrative.nudges.length > 0 && (
            <div style={{ padding: "12px 22px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", margin: "6px 0 10px" }}>
                Worth considering — your call
              </div>
              {review.narrative.nudges.map((n, i) => (
                <div key={i} className="card" style={{ padding: 16, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                    <Icon name={(NUDGE_ICON[n.kind] ?? "check") as never} size={16} />
                    <span style={{ fontSize: 14.5, fontWeight: 650 }}>{n.title}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{n.detail}</p>
                  {n.kind !== "none" && (
                    <button
                      className="btn btn-glass tap"
                      style={{ marginTop: 12, height: 40, fontSize: 13.5 }}
                      onClick={() => go("goal")}
                    >
                      Ask Vera for a plan
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: 12, color: "var(--ink-3)", padding: "14px 22px 0", lineHeight: 1.5 }}>
            A read on shape and history, not investment advice. Nothing happens unless you choose it.
          </p>
        </>
      )}
    </div>
  );
}
