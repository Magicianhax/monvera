"use client";

// Placing — "securing your investment" as a live conveyor. Each holding being
// bought flies in from the left into a spotlight (spinning ring, real logo, its
// dollar amount); the moment it settles it flies out to the right with a check,
// and the next flies in — so every purchase reads as its own discrete, gasless
// step (buys are separate sponsored UserOps now, not one bundle).
//
// A rail beneath shows the whole queue (done ✓ / buying / upcoming), and the bar
// tracks dollars placed + a live ETA. Wired to the REAL invest phase/progress:
//   planning  -> Vera confirms the plan (orb)
//   investing -> the conveyor runs, one leg at a time
// Content is never gated on animation — under reduced motion nothing flies and
// everything is simply visible.
import { useEffect, useState } from "react";
import { Icon, VeraOrb, Seal } from "@/components/design";
import { TokenLogo } from "../TokenLogo";
import { usd } from "@/lib/format";
import { displayFor } from "@/lib/displayAssets";
import type { InvestProgress } from "@/hooks/useInvest";
import fx from "./conveyor.module.css";

export interface PlacingLeg {
  symbol: string;
  usd: number;
}

const nameFor = (sym: string) => displayFor(sym).name || sym;

// The spotlight card (logo + ring/check + label) for one holding.
function StageCard({
  symbol,
  amount,
  leaving,
  skipped,
}: {
  symbol: string;
  amount?: number;
  leaving?: boolean;
  /** Only when leaving: this leg was attempted but did NOT fill. */
  skipped?: boolean;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
    >
      <div style={{ position: "relative", width: 100, height: 100, display: "grid", placeItems: "center" }}>
        {/* soft glow (hidden for a skipped leg) */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: "50%",
            background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 32%, transparent), transparent 70%)",
            filter: "blur(14px)",
            opacity: skipped ? 0 : 1,
          }}
        />
        {/* spinning ring while buying; solid ring when bought; muted ring when skipped */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: leaving
              ? skipped
                ? "var(--line-2)"
                : "var(--primary)"
              : "conic-gradient(from 0deg, transparent 40deg, var(--primary))",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
            animation: leaving ? "none" : "spin 1.1s linear infinite",
          }}
        />
        <TokenLogo symbol={symbol} size={74} />
        {leaving && (
          <span
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: skipped ? "var(--surface-2)" : "var(--primary)",
              color: skipped ? "var(--ink-3)" : "var(--primary-ink)",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,.2)",
            }}
          >
            <Icon name={skipped ? "close" : "check"} size={skipped ? 14 : 17} stroke={3} />
          </span>
        )}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: leaving ? "var(--ink-2)" : "var(--ink)" }}>
          {nameFor(symbol)}
        </div>
        {amount !== undefined && (
          <div className="tnum" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
            {leaving ? (skipped ? "Skipped" : "Bought") : "Buying"} {skipped ? "" : usd(amount)}
          </div>
        )}
      </div>
    </div>
  );
}

export function PlacingScreen({
  phase,
  progress,
  legs,
}: {
  phase: string;
  progress?: InvestProgress | null;
  legs?: PlacingLeg[];
}) {
  const cur = progress?.currentSymbol ?? null;

  // Track the outgoing symbol so it can fly out to the right as the next flies in.
  const [stage, setStage] = useState<{ cur: string | null; leaving: string | null }>({ cur: null, leaving: null });
  useEffect(() => {
    setStage((prev) => (prev.cur === cur ? prev : { cur, leaving: prev.cur }));
  }, [cur]);
  useEffect(() => {
    if (!stage.leaving) return;
    const t = setTimeout(() => setStage((s) => ({ ...s, leaving: null })), 480);
    return () => clearTimeout(t);
  }, [stage.leaving]);

  const usdFor = (sym: string | null) =>
    sym && legs ? legs.find((l) => l.symbol === sym)?.usd : undefined;

  const filledSet = new Set(progress?.filledSymbols ?? []);
  const filledCount = progress?.filledSymbols?.length ?? 0;

  const buying = !!stage.cur;
  const finishing = !!progress && progress.total > 0 && progress.done >= progress.total && !cur;
  const status = buying
    ? "Buying each holding — one gasless transaction each"
    : finishing
      ? "Signing the on-chain record…"
      : "Confirming your plan…";

  return (
    <div
      className="screen screen-pad-top"
      style={{ alignItems: "center", justifyContent: "center", padding: "0 30px", textAlign: "center" }}
    >
      <h1 className="serif" style={{ margin: "0 0 8px", fontSize: 25 }}>
        Securing your investment
      </h1>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", maxWidth: 280 }}>{status}</p>

      {/* Conveyor stage: the buying holding flies in from the left; the just-bought
          one flies out to the right. Falls back to Vera's orb while confirming. */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 300,
          height: 168,
          margin: "20px 0 4px",
          overflow: "hidden",
        }}
      >
        {!buying && !stage.leaving ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <span style={{ display: "block", animation: "breathe 3.6s ease-in-out infinite" }}>
              <VeraOrb size={72} pulse />
            </span>
          </div>
        ) : (
          <>
            {stage.leaving && (
              <div
                key={`leave-${stage.leaving}`}
                className={fx.flyOutRight}
                style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
              >
                <StageCard symbol={stage.leaving} amount={usdFor(stage.leaving)} leaving skipped={!filledSet.has(stage.leaving)} />
              </div>
            )}
            {stage.cur && (
              <div
                key={`cur-${stage.cur}`}
                className={fx.flyInLeft}
                style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
              >
                <StageCard symbol={stage.cur} amount={usdFor(stage.cur)} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Queue rail — the whole plan at a glance: bought ✓ · buying (ringed) ·
          skipped ✕ · upcoming (dim). Only real fills get the check. */}
      {legs && legs.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 9, maxWidth: 300 }}>
          {legs.map((leg, idx) => {
            const filled = filledSet.has(leg.symbol);
            const active = progress ? idx === progress.done && !!progress.currentSymbol : false;
            const attempted = progress ? idx < progress.done : false;
            const failed = attempted && !filled;
            return (
              <div
                key={leg.symbol}
                style={{
                  position: "relative",
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  opacity: filled || active ? 1 : failed ? 0.55 : 0.4,
                  transform: active ? "scale(1.14)" : "scale(1)",
                  boxShadow: active
                    ? "0 0 0 2px var(--primary)"
                    : filled
                      ? "0 0 0 2px var(--primary-soft)"
                      : "none",
                  transition: "opacity .3s var(--ease-out), transform .3s var(--ease-out)",
                }}
              >
                <TokenLogo symbol={leg.symbol} size={30} />
                {(filled || failed) && (
                  <span
                    style={{
                      position: "absolute",
                      right: -2,
                      bottom: -2,
                      width: 15,
                      height: 15,
                      borderRadius: "50%",
                      background: filled ? "var(--primary)" : "var(--surface-2)",
                      color: filled ? "var(--primary-ink)" : "var(--ink-3)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon name={filled ? "check" : "close"} size={9} stroke={3.6} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dollars placed + live ETA. */}
      {progress && progress.total > 0 ? (
        <div style={{ width: "100%", maxWidth: 300, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {filledCount} of {progress.total} bought
            </span>
            {progress.etaSeconds !== null && progress.etaSeconds > 0 && (
              <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>~{progress.etaSeconds}s left</span>
            )}
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "var(--surface-2)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.round((filledCount / progress.total) * 100)}%`,
                background: "var(--primary)",
                borderRadius: 99,
                transition: "width .4s var(--ease-out)",
              }}
            />
          </div>
          <div className="tnum" style={{ marginTop: 9, fontSize: 12.5, color: "var(--ink-2)" }}>
            {usd(progress.spentUsd)} of {usd(progress.totalUsd)} placed
          </div>
          {progress.mode === "manual" && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-3)" }}>
              Approve each prompt to continue.
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 26, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>
          <Seal size={18} /> Gas-free · signed &amp; verified on-chain
        </div>
      )}
    </div>
  );
}
