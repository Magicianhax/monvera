"use client";

// The "thinking" moment — a living Vera animation while the REAL allocation is
// being built (useInvest.allocate → POST /api/allocate). Faithful re-skin of the
// design (screens_lite.jsx · Thinking), but the copy steps are purely cosmetic:
// the router advances to the plan only when the real allocation resolves (or
// surfaces an error), not on a fixed timer.
//
// Motion: GSAP breathes the orb (transform-only loop) and rises each step line
// in as the timer advances. Content is never gated on animation — under reduced
// motion no tween runs and everything is simply visible.
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { VeraMascot } from "@/components/design/VeraMascot";
import { ThinkingDots } from "./primitives";

gsap.registerPlugin(useGSAP);

const STEPS = [
  "Reading your goal…",
  "Picking real companies & funds…",
  "Balancing growth and safety…",
  "Checking today's prices…",
  "Signing the plan…",
];

export function ThinkingScreen() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((p) => Math.min(p + 1, STEPS.length - 1)), 720);
    return () => clearInterval(t);
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);

  // Gentle breathing on Vera's orb — a calm "working" presence. Runs once on
  // mount so the loop never restarts mid-breath.
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

  // The active step line fades/rises in on every index change (gsap.from → the
  // line is simply visible when tweens don't run).
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-fx='step']", { y: 10, opacity: 0, duration: 0.35, ease: "power2.out" });
      });
      return () => mm.revert();
    },
    { scope: rootRef, dependencies: [i] },
  );

  return (
    <div
      ref={rootRef}
      className="screen screen-pad-top"
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 32px" }}
    >
      <div style={{ position: "relative", marginBottom: 34, display: "grid", placeItems: "center" }}>
        {/* soft breathing glow instead of hard expanding rings */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            width: 150,
            height: 150,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--primary) 42%, transparent), transparent 68%)",
            filter: "blur(26px)",
            animation: "breathe 3.6s ease-in-out infinite",
          }}
        />
        {/* GSAP gently breathes Vera while she works */}
        <span data-fx="orb" style={{ display: "block" }}>
          <VeraMascot size={132} />
        </span>
      </div>
      <h1 className="serif" style={{ margin: "0 0 22px", fontSize: 28, letterSpacing: "-.01em" }}>
        Vera is building
        <br />
        your plan
      </h1>
      {/* Active step line — GSAP rises it in on each index change (replaces the
          old xfade-layer blur morph so nothing double-animates). */}
      <div style={{ display: "grid", minHeight: 26 }}>
        <div
          data-fx="step"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            fontSize: 15.5,
            color: "var(--ink-2)",
            fontWeight: 500,
          }}
        >
          <ThinkingDots /> {STEPS[i]}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 26 }}>
        {STEPS.map((_, idx) => (
          <span
            key={idx}
            style={{
              width: idx <= i ? 22 : 8,
              height: 5,
              borderRadius: 99,
              background: idx <= i ? "var(--primary)" : "var(--line)",
              transition: "width .4s var(--ease-out), background .4s var(--ease-out)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
