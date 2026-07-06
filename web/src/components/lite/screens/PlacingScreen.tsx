"use client";

// Placing — "securing your investment" progress. Faithful re-skin of the design
// (screens_invest.jsx · Placing) wired to the REAL invest phase from useInvest:
//   planning  -> "Confirming your plan"     (server signs the plan)
//   approving -> "Buying each holding"
//   investing -> "Securing it to your account" (batched, sponsored UserOp)
// The ring + active step are derived from the real phase, not a fixed timer.
//
// Motion: GSAP breathes the orb (transform-only loop) and pops each step's icon
// / fades its label as the phase advances. Content is never gated on animation —
// under reduced motion no tween runs and everything is simply visible.
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Icon, VeraOrb, Seal } from "@/components/design";
import { Spinner } from "./primitives";

gsap.registerPlugin(useGSAP);

const STEPS = ["Confirming your plan", "Buying each holding", "Securing it to your account"];

// Map invest phase → active step index (0..2).
function stepFor(phase: string): number {
  if (phase === "planning") return 0;
  if (phase === "approving") return 1;
  return 2; // investing
}

export function PlacingScreen({ phase }: { phase: string }) {
  const i = stepFor(phase);
  const rootRef = useRef<HTMLDivElement>(null);

  // Gentle breathing on Vera's orb — runs once on mount so the loop never
  // restarts when the phase changes.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.to("[data-fx='orb']", {
          scale: 1.06,
          duration: 1.6,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        });
      });
      return () => mm.revert();
    },
    { scope: rootRef },
  );

  // Step activation, keyed on the real phase: the newly active step's icon pops
  // in with a tiny overshoot and its label fades; the step that just completed
  // gets the same pop as its spinner swaps to a check.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(`[data-fx-step='${i}'] [data-fx='icon']`, {
          scale: 0.7,
          opacity: 0,
          duration: 0.3,
          ease: "back.out(1.7)",
        });
        gsap.from(`[data-fx-step='${i}'] [data-fx='label']`, {
          opacity: 0,
          duration: 0.35,
          ease: "power2.out",
        });
        if (i > 0) {
          gsap.from(`[data-fx-step='${i - 1}'] [data-fx='icon']`, {
            scale: 0.7,
            duration: 0.25,
            ease: "back.out(1.7)",
          });
        }
      });
      return () => mm.revert();
    },
    { scope: rootRef, dependencies: [i] },
  );

  return (
    <div
      ref={rootRef}
      className="screen screen-pad-top"
      style={{ alignItems: "center", justifyContent: "center", padding: "0 36px", textAlign: "center" }}
    >
      {/* Soft breathing glow (no progress ring) — the step list below shows progress. */}
      <div style={{ position: "relative", width: 110, height: 110, marginBottom: 30, display: "grid", placeItems: "center" }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            width: 132,
            height: 132,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--primary) 42%, transparent), transparent 68%)",
            filter: "blur(26px)",
            animation: "breathe 3.6s ease-in-out infinite",
          }}
        />
        {/* GSAP breathes this wrapper (the orb img keeps its own CSS spin) */}
        <span data-fx="orb" style={{ display: "block" }}>
          <VeraOrb size={64} pulse />
        </span>
      </div>

      <h1 className="serif" style={{ margin: "0 0 24px", fontSize: 26 }}>
        Securing your
        <br />
        investment
      </h1>

      <div
        className="card"
        style={{ width: "100%", maxWidth: 300, padding: "4px 18px", textAlign: "left" }}
      >
        {STEPS.map((s, idx) => (
          <div
            key={idx}
            data-fx-step={idx}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 0",
              borderTop: idx ? "1px solid var(--line-2)" : "none",
              opacity: idx <= i ? 1 : 0.4,
              transition: "opacity .3s var(--ease-out)",
            }}
          >
            <span
              data-fx="icon"
              style={{
                width: 24,
                height: 24,
                borderRadius: 99,
                flex: "none",
                display: "grid",
                placeItems: "center",
                background: idx < i ? "var(--primary)" : "var(--surface-2)",
                color: idx < i ? "var(--primary-ink)" : "var(--ink-3)",
                transition: "background .3s var(--ease-out), color .3s var(--ease-out)",
              }}
            >
              {idx < i ? (
                <Icon name="check" size={15} stroke={2.6} />
              ) : idx === i ? (
                <Spinner small />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }} />
              )}
            </span>
            <span data-fx="label" style={{ fontSize: 15, fontWeight: 500, textAlign: "left" }}>{s}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>
        <Seal size={18} /> Gas-free · signed &amp; verified on-chain
      </div>
    </div>
  );
}
