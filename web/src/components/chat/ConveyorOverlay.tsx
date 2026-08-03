"use client";

// The conveyor, chat-native. The old app's "securing your investment" stage —
// each holding flies into the spotlight, gets its check, flies out — rebuilt
// on the CHAT design tokens (var(--panel)/--ink/--primary) instead of mounting
// the lite screens raw, which dragged the old palette and its phone-column
// layout into the new app. One component covers buying and selling; the shell
// is a centered glass card that reads right on desktop and phone alike.
import { useEffect, useState } from "react";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { displayFor } from "@/lib/displayAssets";
import { PIcon, usd } from "./chatKit";
import fx from "@/components/lite/screens/conveyor.module.css";
import { VenueMark, venueLabel, VENUE } from "./venueBrand";
import { VENUE_RACE_CSS } from "./VenueRace";
import type { VenueName } from "@/hooks/useSwap";

export interface ConveyorLeg {
  symbol: string;
  usd: number;
}

interface ConveyorProps {
  mode: "buy" | "sell";
  /** Symbol currently in the spotlight (null while confirming / finishing). */
  current: string | null;
  legs: ConveyorLeg[];
  /** Symbols that actually filled — only these get the check. */
  filled: string[];
  /** Which venue won each filled leg (symbol -> venue). Absent while selling. */
  legVenues?: Record<string, VenueName>;
  /** Venues competing on this batch, for the live "who's bidding" strip. */
  competing?: VenueName[];
  /** Legs attempted so far (drives skipped detection on the rail). */
  done: number;
  total: number;
  movedUsd: number;
  totalUsd: number;
  etaSeconds: number | null;
  manual?: boolean;
  /** Ask the batch to stop after the in-flight trade. The overlay used to have
   *  no way out at all — a stuck run held the whole app hostage. */
  onStop?: () => void;
}

const nameFor = (sym: string) => displayFor(sym).name || sym;

function StageCard({ symbol, amount, mode, leaving, skipped }: {
  symbol: string;
  amount?: number;
  mode: "buy" | "sell";
  leaving?: boolean;
  skipped?: boolean;
}) {
  const verb = leaving
    ? (skipped ? "Skipped" : mode === "buy" ? "Bought" : "Sold")
    : mode === "buy" ? "Buying" : "Selling";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: 100, height: 100, display: "grid", placeItems: "center" }}>
        <span aria-hidden style={{ position: "absolute", inset: -8, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 32%, transparent), transparent 70%)", filter: "blur(14px)", opacity: skipped ? 0 : 1 }} />
        <span aria-hidden style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: leaving ? (skipped ? "var(--line)" : "var(--primary)") : "conic-gradient(from 0deg, transparent 40deg, var(--primary))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
          animation: leaving ? "none" : "mvcspin 1.1s linear infinite",
        }} />
        <TokenLogo symbol={symbol} size={74} />
        {leaving && (
          <span style={{ position: "absolute", right: 0, bottom: 0, width: 30, height: 30, borderRadius: "50%", background: skipped ? "var(--panel-2)" : "var(--primary)", color: skipped ? "var(--ink-3)" : "var(--primary-ink)", display: "grid", placeItems: "center", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
            <PIcon name={skipped ? "ph-x" : "ph-check"} size={skipped ? 14 : 17} weight="bold" />
          </span>
        )}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: leaving ? "var(--ink-2)" : "var(--ink)" }}>{nameFor(symbol)}</div>
        {amount !== undefined && (
          <div className="tnum" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
            {verb} {skipped ? "" : usd(amount)}
          </div>
        )}
      </div>
    </div>
  );
}

/** One tap arms the stop; the trade already in flight still completes (an
 *  atomic settle cannot be recalled), everything after it stays unsold/unbought
 *  and shows in the receipt as such. */
function StopButton({ onStop }: { onStop: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      onClick={() => {
        if (!armed) {
          setArmed(true);
          onStop();
        }
      }}
      disabled={armed}
      style={{ display: "block", width: "100%", height: 40, marginTop: 12, borderRadius: 12, fontSize: 13, fontWeight: 650, border: "1px solid var(--line)", background: "transparent", color: armed ? "var(--ink-3)" : "var(--ink-2)", cursor: armed ? "default" : "pointer" }}
    >
      {armed ? "Stopping after this trade…" : "Stop after this trade"}
    </button>
  );
}

export function ConveyorOverlay(p: ConveyorProps) {
  const { current } = p;
  // Track the outgoing symbol so it flies right as the next flies in.
  const [stage, setStage] = useState<{ cur: string | null; leaving: string | null }>({ cur: null, leaving: null });
  useEffect(() => {
    setStage((prev) => (prev.cur === current ? prev : { cur: current, leaving: prev.cur }));
  }, [current]);
  useEffect(() => {
    if (!stage.leaving) return;
    const t = setTimeout(() => setStage((s) => ({ ...s, leaving: null })), 480);
    return () => clearTimeout(t);
  }, [stage.leaving]);

  const usdFor = (sym: string | null) => (sym ? p.legs.find((l) => l.symbol === sym)?.usd : undefined);
  const filledSet = new Set(p.filled);
  const competing = p.competing ?? [];
  // Running count of which venue won each filled leg, biggest first.
  const wonTally = Object.entries(
    Object.values(p.legVenues ?? {}).reduce<Record<string, number>>((acc, v) => {
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]) as [VenueName, number][];
  const buying = !!stage.cur;
  const finishing = p.total > 0 && p.done >= p.total && !current;
  const title = p.mode === "buy" ? "Securing your investment" : "Cashing out";
  const status = buying
    ? p.mode === "buy" ? "Buying each holding — one gasless transaction each" : "Selling each holding back to cash — gasless"
    : finishing
      ? p.mode === "buy" ? "Signing the on-chain record…" : "Wrapping up…"
      : "Confirming…";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 130, display: "grid", placeItems: "center", padding: 16, background: "color-mix(in srgb, var(--bg) 55%, transparent)", backdropFilter: "blur(18px) saturate(1.1)", WebkitBackdropFilter: "blur(18px) saturate(1.1)" }}>
      <div style={{ width: "min(420px, 100%)", maxHeight: "92vh", overflowY: "auto", borderRadius: 26, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "0 30px 80px rgba(0,0,0,.35)", padding: "26px 24px 24px", textAlign: "center" }}>
        <h2 className="serif" style={{ margin: "0 0 6px", fontSize: 23, fontWeight: 500, color: "var(--ink)" }}>{title}</h2>
        <p style={{ margin: "0 auto", fontSize: 13, color: "var(--ink-2)", maxWidth: 290 }}>{status}</p>

        {/* spotlight */}
        <div style={{ position: "relative", width: "100%", height: 168, margin: "18px 0 6px", overflow: "hidden" }}>
          {!buying && !stage.leaving ? (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <span aria-hidden style={{ width: 72, height: 72, borderRadius: "50%", background: "radial-gradient(circle at 32% 30%, color-mix(in srgb, var(--primary) 75%, #fff), var(--primary) 58%, color-mix(in srgb, var(--primary) 55%, #000))", boxShadow: "0 10px 30px color-mix(in srgb, var(--primary) 45%, transparent)", animation: "mvcspin 7s linear infinite" }} />
            </div>
          ) : (
            <>
              {stage.leaving && (
                <div key={`leave-${stage.leaving}`} className={fx.flyOutRight} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <StageCard symbol={stage.leaving} amount={usdFor(stage.leaving)} mode={p.mode} leaving skipped={!filledSet.has(stage.leaving)} />
                </div>
              )}
              {stage.cur && (
                <div key={`cur-${stage.cur}`} className={fx.flyInLeft} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <StageCard symbol={stage.cur} amount={usdFor(stage.cur)} mode={p.mode} />
                </div>
              )}
            </>
          )}
        </div>

        <style dangerouslySetInnerHTML={{ __html: VENUE_RACE_CSS }} />
        {/* queue rail */}
        {p.legs.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 9, margin: "0 auto", maxWidth: 300 }}>
            {p.legs.map((leg, idx) => {
              const filled = filledSet.has(leg.symbol);
              const active = idx === p.done && !!current;
              const attempted = idx < p.done;
              const failed = attempted && !filled;
              const wonBy = p.legVenues?.[leg.symbol];
              return (
                <div key={leg.symbol} style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", opacity: filled || active ? 1 : failed ? 0.55 : 0.4, transform: active ? "scale(1.14)" : "scale(1)", boxShadow: active ? "0 0 0 2px var(--primary)" : filled ? "0 0 0 2px color-mix(in srgb, var(--primary) 45%, transparent)" : "none", transition: "opacity .3s ease, transform .3s ease" }}>
                  <TokenLogo symbol={leg.symbol} size={30} />
                  {(filled || failed) && (
                    <span style={{ position: "absolute", right: -2, bottom: -2, width: 15, height: 15, borderRadius: "50%", background: filled ? "var(--primary)" : "var(--panel-2)", color: filled ? "var(--primary-ink)" : "var(--ink-3)", display: "grid", placeItems: "center" }}>
                      <PIcon name={filled ? "ph-check" : "ph-x"} size={9} weight="bold" />
                    </span>
                  )}
                  {/* Which venue won this leg — a plan can fill each leg elsewhere. */}
                  {filled && wonBy && (
                    <span
                      title={`Best price: ${venueLabel(wonBy)}`}
                      style={{ position: "absolute", left: -3, top: -3, width: 15, height: 15, borderRadius: "50%", background: "var(--panel)", border: `1px solid color-mix(in srgb, ${VENUE[wonBy].color} 45%, transparent)`, display: "grid", placeItems: "center" }}
                    >
                      <VenueMark venue={wonBy} size={9} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* who is competing, and who has actually been winning so far */}
        {competing.length > 1 && (
          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
            {wonTally.length === 0 ? (
              // Before the first fill there is no winner yet — say who's bidding.
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <span className="mvv-sweep" style={{ fontSize: 11.5, fontWeight: 650 }}>
                  {competing.length} venues competing for each holding
                </span>
                {competing.map((v) => (
                  <VenueMark key={v} venue={v} size={14} muted />
                ))}
              </div>
            ) : (
              <>
                <span style={{ fontSize: 11, fontWeight: 650, color: "var(--ink-3)" }}>Best price won by</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {wonTally.map(([v, n]) => (
                    <span
                      key={v}
                      className="mvv-in"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "4px 9px", borderRadius: 6,
                        border: `1px solid color-mix(in srgb, ${VENUE[v].color} 34%, transparent)`,
                        background: `color-mix(in srgb, ${VENUE[v].color} 8%, transparent)`,
                        fontSize: 11.5, fontWeight: 650, color: "var(--ink-2)",
                      }}
                    >
                      <VenueMark venue={v} size={14} />
                      {venueLabel(v)}
                      <span className="tnum" style={{ color: VENUE[v].color, fontWeight: 700 }}>×{n}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* progress + ETA */}
        {p.total > 0 && (
          <div style={{ width: "100%", maxWidth: 300, margin: "18px auto 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {p.filled.length} of {p.total} {p.mode === "buy" ? "bought" : "sold"}
              </span>
              {p.etaSeconds !== null && p.etaSeconds > 0 && (
                <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>~{p.etaSeconds}s left</span>
              )}
            </div>
            <div style={{ height: 8, borderRadius: 99, background: "var(--panel-2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((p.filled.length / p.total) * 100)}%`, background: "var(--primary)", borderRadius: 99, transition: "width .4s ease" }} />
            </div>
            <div className="tnum" style={{ marginTop: 9, fontSize: 12.5, color: "var(--ink-2)" }}>
              {usd(p.movedUsd)} of {usd(p.totalUsd)} {p.mode === "buy" ? "placed" : "back to cash"}
            </div>
            {p.manual && <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-3)" }}>Approve each prompt to continue.</div>}
          </div>
        )}
        <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
          <PIcon name="ph-seal-check" size={15} weight="fill" style={{ color: "var(--primary)" }} /> Gas-free · signed &amp; recorded on-chain
        </div>
        {p.onStop && !finishing && (
          <StopButton onStop={p.onStop} />
        )}
      </div>
    </div>
  );
}
