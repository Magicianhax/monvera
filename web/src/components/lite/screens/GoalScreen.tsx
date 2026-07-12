"use client";

// Goal input — the start of a conversation with Vera: an amount, a goal in plain
// words, and a few tappable starting points. On "Build my plan" it hands
// { goal, amt } up to the router, which calls useInvest.allocate (POST /api/allocate).
// Restructured for the rounded/glass theme: %-of-balance amount presets and
// iconed suggestion chips so a first-timer can move without typing.
import { useEffect, useRef, useState } from "react";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, VeraOrb, type IconName } from "@/components/design";
import { usd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { MIN_INVEST_USD } from "@/lib/arcusShared";
import { iconBtn, VeraTag } from "./primitives";

const SUGGESTIONS: { icon: IconName; label: string }[] = [
  { icon: "trend", label: "Grow it over a few years, mostly big tech" },
  { icon: "shield", label: "Play it safe and still earn a bit" },
  { icon: "orbit", label: "A little of everything to start" },
  { icon: "spark", label: "Go big on AI companies" },
];

const PRESETS: { label: string; frac: number }[] = [
  { label: "25%", frac: 0.25 },
  { label: "50%", frac: 0.5 },
  { label: "Max", frac: 1 },
];

export function GoalScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const balance = bal?.value ?? 0;

  const [goal, setGoal] = useState("");
  // Seeded from the REAL balance once it loads (was a hardcoded $300, which sat
  // there even when the user held $3). Never overwrite something they typed.
  const [amt, setAmt] = useState("");
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || amt !== "" || balance <= 0) return;
    setAmt(String(Math.max(1, Math.floor(balance))));
  }, [balance, amt]);

  const amount = parseFloat(amt) || 0;
  const over = balance > 0 && amount > balance + 1e-6;
  // Below the RFQ floor, a plan can't buy a single holding that fills — so a
  // plan needs at least one leg's worth. Enforced here so the user never lands
  // in a partial fill.
  const under = amount > 0 && amount < MIN_INVEST_USD;
  const ready = goal.trim().length > 3 && amount >= MIN_INVEST_USD && !over;

  const setPreset = (frac: number) => {
    // Whole dollars, never more than the balance; Max uses the full balance.
    const v = Math.max(1, Math.floor(balance * frac));
    touched.current = true;
    setAmt(String(v));
    haptic.select();
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go("home")} style={iconBtn} className="tap" aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <div style={{ marginLeft: 4 }}>
          <VeraTag verified />
        </div>
      </div>

      <div className="anim-rise" style={{ padding: "26px 22px 0", flex: 1 }}>
        <h1 className="display" style={{ margin: 0 }}>
          What are you
          <br />
          hoping to do?
        </h1>
        <p className="body" style={{ marginTop: 12, maxWidth: 300 }}>
          Say it however feels natural. No finance words needed; I&apos;ll handle the rest.
        </p>

        {/* amount + quick presets from your balance */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="label-eyebrow">How much to invest</span>
            {balance > 0 && (
              <div style={{ display: "flex", gap: 6 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="chip tap"
                    onClick={() => setPreset(p.frac)}
                    style={{ height: 28, padding: "0 11px", fontSize: 12.5, fontWeight: 500 }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 16px" }}>
            <span className="tnum" style={{ fontSize: 30, fontWeight: 600, color: "var(--ink-3)" }}>
              $
            </span>
            <input
              value={amt}
              onChange={(e) => {
                touched.current = true;
                setAmt(e.target.value.replace(/[^0-9.]/g, ""));
              }}
              inputMode="decimal"
              aria-label="Amount to invest"
              className="tnum"
              style={{ flex: 1, fontSize: 30, fontWeight: 600, letterSpacing: "-.02em", width: "100%" }}
            />
            <span className="caption" style={{ fontWeight: 500 }}>of {usd(balance)}</span>
          </div>
        </div>

        {/* goal text */}
        <div style={{ marginTop: 18 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            Your goal
          </div>
          <div className="field" style={{ padding: "14px 16px" }}>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              aria-label="Your goal"
              placeholder="e.g. Grow this over a few years, mostly big names, but keep some safe…"
              style={{ width: "100%", fontSize: 16, lineHeight: 1.45, display: "block" }}
            />
          </div>
        </div>

        {/* suggestions — tap one to start; each carries a real icon for scanning */}
        <div style={{ marginTop: 16 }}>
          <div className="label-eyebrow" style={{ marginBottom: 8 }}>
            Or start from one of these
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUGGESTIONS.map((s) => {
              const on = goal === s.label;
              return (
                <button
                  key={s.label}
                  className={`chip tap ${on ? "is-on" : ""}`}
                  onClick={() => {
                    setGoal(s.label);
                    haptic.select();
                  }}
                  style={{
                    height: "auto",
                    padding: "9px 13px 9px 11px",
                    whiteSpace: "normal",
                    textAlign: "left",
                    lineHeight: 1.3,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Icon name={s.icon} size={16} style={{ flex: "none", color: on ? undefined : "var(--primary)" }} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
        {over && (
          <p style={{ textAlign: "center", margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-3)" }}>
            That&apos;s more than your {usd(balance)}. Lower the amount or add money first.
          </p>
        )}
        {under && !over && (
          <p style={{ textAlign: "center", margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-3)" }}>
            The smallest plan is ${MIN_INVEST_USD}. Below that, a holding can&apos;t be bought reliably.
          </p>
        )}
        <button
          className="btn btn-primary btn-block btn-lg tap"
          disabled={!ready}
          onClick={() => go("thinking", { goal: goal.trim(), amt: amount })}
        >
          <VeraOrb size={26} /> Build my plan
        </button>
      </div>
    </div>
  );
}
