"use client";

// SellingScreen — the sell-all counterpart to PlacingScreen: each holding being
// sold flies into a spotlight (spinning ring, real logo), then out to the right
// with a check as the next flies in. Tracks dollars cashed out + a live ETA.
// Wired to useSellAll's live progress.
import { useEffect, useState } from "react";
import { Icon, VeraOrb, Seal } from "@/components/design";
import { TokenLogo } from "../TokenLogo";
import { usd } from "@/lib/format";
import { displayFor } from "@/lib/displayAssets";
import type { SellProgress } from "@/hooks/useSellAll";
import fx from "./conveyor.module.css";

const nameFor = (sym: string) => displayFor(sym).name || sym;

function StageCard({ symbol, leaving, skipped }: { symbol: string; leaving?: boolean; skipped?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: 100, height: 100, display: "grid", placeItems: "center" }}>
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
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: leaving ? (skipped ? "var(--line-2)" : "var(--primary)") : "conic-gradient(from 0deg, transparent 40deg, var(--primary))",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
            animation: leaving ? "none" : "spin 1.1s linear infinite",
          }}
        />
        <TokenLogo symbol={symbol} size={74} />
        {leaving && (
          <span style={{ position: "absolute", right: 0, bottom: 0, width: 30, height: 30, borderRadius: "50%", background: skipped ? "var(--surface-2)" : "var(--primary)", color: skipped ? "var(--ink-3)" : "var(--primary-ink)", display: "grid", placeItems: "center", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
            <Icon name={skipped ? "close" : "check"} size={skipped ? 14 : 17} stroke={3} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: leaving ? "var(--ink-2)" : "var(--ink)" }}>
        {leaving ? (skipped ? "Skipped" : "Sold") : "Selling"} {nameFor(symbol)}
      </div>
    </div>
  );
}

export function SellingScreen({ progress }: { progress?: SellProgress | null }) {
  const cur = progress?.currentSymbol ?? null;
  const [stage, setStage] = useState<{ cur: string | null; leaving: string | null }>({ cur: null, leaving: null });
  useEffect(() => {
    setStage((prev) => (prev.cur === cur ? prev : { cur, leaving: prev.cur }));
  }, [cur]);
  useEffect(() => {
    if (!stage.leaving) return;
    const t = setTimeout(() => setStage((s) => ({ ...s, leaving: null })), 480);
    return () => clearTimeout(t);
  }, [stage.leaving]);

  const selling = !!stage.cur;
  const filledSet = new Set(progress?.filledSymbols ?? []);
  const filledCount = progress?.filledSymbols?.length ?? 0;

  return (
    <div className="screen screen-pad-top" style={{ alignItems: "center", justifyContent: "center", padding: "0 30px", textAlign: "center" }}>
      <h1 className="serif" style={{ margin: "0 0 8px", fontSize: 25 }}>
        Cashing out
      </h1>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", maxWidth: 280 }}>
        {selling ? "Selling each holding back to USDG — gaslessly" : "Getting your proceeds ready…"}
      </p>

      <div style={{ position: "relative", width: "100%", maxWidth: 300, height: 168, margin: "20px 0 4px", overflow: "hidden" }}>
        {!selling && !stage.leaving ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <span style={{ display: "block", animation: "breathe 3.6s ease-in-out infinite" }}>
              <VeraOrb size={72} pulse />
            </span>
          </div>
        ) : (
          <>
            {stage.leaving && (
              <div key={`leave-${stage.leaving}`} className={fx.flyOutRight} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                <StageCard symbol={stage.leaving} leaving skipped={!filledSet.has(stage.leaving)} />
              </div>
            )}
            {stage.cur && (
              <div key={`cur-${stage.cur}`} className={fx.flyInLeft} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                <StageCard symbol={stage.cur} />
              </div>
            )}
          </>
        )}
      </div>

      {progress && progress.total > 0 ? (
        <div style={{ width: "100%", maxWidth: 300, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {filledCount} of {progress.total} sold
            </span>
            {progress.etaSeconds !== null && progress.etaSeconds > 0 && (
              <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>~{progress.etaSeconds}s left</span>
            )}
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "var(--surface-2)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((filledCount / progress.total) * 100)}%`, background: "var(--primary)", borderRadius: 99, transition: "width .4s var(--ease-out)" }} />
          </div>
          <div className="tnum" style={{ marginTop: 9, fontSize: 12.5, color: "var(--ink-2)" }}>
            {usd(progress.proceedsUsd)} of ~{usd(progress.totalUsd)} sold
          </div>
          {progress.mode === "manual" && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-3)" }}>Approve each prompt to continue.</div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 26, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>
          <Seal size={18} /> Gas-free · non-custodial
        </div>
      )}
    </div>
  );
}
