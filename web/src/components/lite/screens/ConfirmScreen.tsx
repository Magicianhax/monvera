"use client";

// Choose how the plan gets placed, right before it executes:
//   auto   — Vera signs each holding for you, silently, and you watch it go.
//   manual — you approve every signature in your wallet.
// Both are non-custodial and settle the exact plan you just reviewed; the only
// difference is who taps "sign". Shown between the plan review and placing.
import { useState } from "react";
import { Icon, VeraOrb, type IconName } from "@/components/design";
import { usd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { iconBtn } from "./primitives";
import type { InvestMode } from "@/hooks/useInvest";

interface Option {
  mode: InvestMode;
  icon: IconName;
  title: string;
  blurb: string;
  pros: string[];
  cons: string[];
}

export function ConfirmScreen({
  amount,
  holdings,
  onChoose,
  onBack,
}: {
  amount: number;
  holdings: number;
  onChoose: (mode: InvestMode) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<InvestMode>("auto");

  const OPTIONS: Option[] = [
    {
      mode: "auto",
      icon: "spark",
      title: "Let Vera place it",
      blurb: "One tap. Vera signs each holding for you and you watch it happen.",
      pros: ["Nothing to tap through", "Fastest way in", "Live progress as it buys"],
      cons: [`Vera signs the ${holdings} holdings you just approved, for you`],
    },
    {
      mode: "manual",
      icon: "shield",
      title: "Approve each step",
      blurb: "You confirm every signature in your wallet, one holding at a time.",
      pros: ["You see and approve every trade", "Maximum control"],
      cons: [`${holdings} approvals to tap through`, "Slower"],
    },
  ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={onBack} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
      </div>

      <div className="anim-rise" style={{ padding: "18px 22px 0", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <VeraOrb size={30} />
          <h1 className="serif" style={{ margin: 0, fontSize: 25 }}>
            How should we place it?
          </h1>
        </div>
        <p className="body" style={{ marginTop: 6, maxWidth: 320 }}>
          Investing {usd(amount)} across {holdings} {holdings === 1 ? "holding" : "holdings"}. Both ways
          buy the exact plan you just reviewed, and your funds stay yours the whole time.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          {OPTIONS.map((o) => {
            const on = mode === o.mode;
            return (
              <button
                key={o.mode}
                onClick={() => {
                  setMode(o.mode);
                  haptic.select();
                }}
                className="tap"
                style={{
                  textAlign: "left",
                  border: `1.5px solid ${on ? "var(--primary)" : "var(--line-2)"}`,
                  background: on ? "var(--primary-soft, var(--surface-2))" : "var(--surface)",
                  borderRadius: "var(--r)",
                  padding: "16px 16px 14px",
                  transition: "border-color .18s, background .18s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      background: on ? "var(--primary)" : "var(--surface-2)",
                      color: on ? "var(--primary-ink)" : "var(--primary)",
                    }}
                  >
                    <Icon name={o.icon} size={18} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15.5 }}>{o.title}</div>
                  </div>
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 99,
                      border: `2px solid ${on ? "var(--primary)" : "var(--line-2)"}`,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {on && <span style={{ width: 10, height: 10, borderRadius: 99, background: "var(--primary)" }} />}
                  </span>
                </div>
                <p style={{ margin: "9px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--ink-2)" }}>{o.blurb}</p>
                <div style={{ display: "flex", gap: 14, marginTop: 11, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 120 }}>
                    {o.pros.map((p) => (
                      <div key={p} style={{ display: "flex", gap: 6, fontSize: 12, color: "var(--ink-2)", marginBottom: 3 }}>
                        <Icon name="check" size={13} stroke={2.6} style={{ color: "var(--primary)", flex: "none", marginTop: 1 }} />
                        {p}
                      </div>
                    ))}
                  </div>
                  <div style={{ minWidth: 120 }}>
                    {o.cons.map((c) => (
                      <div key={c} style={{ display: "flex", gap: 6, fontSize: 12, color: "var(--ink-3)", marginBottom: 3 }}>
                        <span style={{ flex: "none", marginTop: 1, width: 13, textAlign: "center" }}>·</span>
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
        <button
          className="btn btn-primary btn-block btn-lg tap"
          onClick={() => {
            haptic.medium();
            onChoose(mode);
          }}
        >
          {mode === "auto" ? "Place my plan" : "Approve and place"}
        </button>
      </div>
    </div>
  );
}
