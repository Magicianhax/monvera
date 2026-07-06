"use client";

// Tiny shared primitives for the Lite screens — ported from the design handoff
// (the inline Spinner / iconBtn / VeraTag used across onboarding + invest screens).
import type { CSSProperties } from "react";
import { Icon, VeraOrb, Seal } from "@/components/design";
import { TokenLogo } from "../TokenLogo";

export function Spinner({ small }: { small?: boolean }) {
  const s = small ? 18 : 22;
  return (
    <span
      className="spin"
      style={{
        width: s,
        height: s,
        borderRadius: "50%",
        border: "2.4px solid color-mix(in srgb, currentColor 35%, transparent)",
        borderTopColor: "currentColor",
        display: "inline-block",
      }}
    />
  );
}

// Three-dot "thinking" indicator — calmer and more intentional than a ring
// spinner for Vera's working states (and it doesn't read as a harsh partial ring).
// Inherits color via currentColor; dots pulse in sequence.
export function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            opacity: 0.55,
            animation: `dotPulse 1.1s var(--ease-out) ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// Compact prev/next pager for paginated lists (Activity, Transactions).
// Renders nothing for a single page.
export function Pager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const btn: CSSProperties = {
    width: 42,
    height: 36,
    borderRadius: 5,
    background: "var(--surface-2)",
    display: "grid",
    placeItems: "center",
    color: "var(--ink-2)",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "16px 0 2px" }}>
      <button
        className="tap"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        style={{ ...btn, opacity: page <= 0 ? 0.4 : 1 }}
      >
        <Icon name="chevL" size={18} />
      </button>
      <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)", minWidth: 52, textAlign: "center" }}>
        {page + 1} / {pageCount}
      </span>
      <button
        className="tap"
        aria-label="Next page"
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
        style={{ ...btn, opacity: page >= pageCount - 1 ? 0.4 : 1 }}
      >
        <Icon name="chevR" size={18} />
      </button>
    </div>
  );
}

export const iconBtn: CSSProperties = {
  width: 44, // ≥44px touch target (WCAG 2.5.5 / Apple HIG)
  height: 44,
  borderRadius: 99,
  background: "var(--surface-2)",
  display: "grid",
  placeItems: "center",
  color: "var(--ink-2)",
};

// Section-box grammar (shared): an outer card whose header + rows-as-mini-boxes
// sit inside. Used by Home / Owned / Activity / Wallet so lists read the same.
export const boxHead: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--ink-2)",
  padding: "4px 6px 10px",
};
export const innerBox: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "12px",
  textAlign: "left",
  // Translucent so rows melt into the frosted card behind them.
  background: "var(--glass-bg-2)",
  borderRadius: "var(--r-lg)",
};

// Overlapping stack of REAL company logos (arcus brand marks via TokenLogo).
// Each logo sits in a small ring so they read cleanly as they overlap on a
// frosted card. Used to show, at a glance, the real companies behind a plan or
// an autopilot run — "translate, never expose": company logos, not tokens.
export function LogoStack({
  symbols,
  size = 26,
  max = 4,
  ring = "var(--surface)",
}: {
  symbols: string[];
  size?: number;
  max?: number;
  ring?: string;
}) {
  const shown = symbols.slice(0, max);
  const extra = symbols.length - shown.length;
  const overlap = Math.round(size * 0.36);
  return (
    <div style={{ display: "flex", alignItems: "center" }} aria-hidden>
      {shown.map((s, i) => (
        <span
          key={s + i}
          style={{
            marginLeft: i === 0 ? 0 : -overlap,
            borderRadius: "50%",
            background: ring,
            padding: 1.5,
            display: "block",
            position: "relative",
            zIndex: shown.length - i,
          }}
        >
          <TokenLogo symbol={s} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          style={{
            marginLeft: -overlap,
            width: size + 3,
            height: size + 3,
            borderRadius: "50%",
            background: "var(--surface-2)",
            color: "var(--ink-2)",
            display: "grid",
            placeItems: "center",
            fontSize: Math.round(size * 0.36),
            fontWeight: 700,
            boxShadow: `0 0 0 1.5px ${ring}`,
            position: "relative",
            zIndex: 0,
          }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

// Vera name + orb, optionally with a "verified" trust pill (used on Goal/Plan).
export function VeraTag({ verified = false }: { verified?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <VeraOrb size={26} />
      <span style={{ fontWeight: 700, fontSize: 16 }}>Vera</span>
      {verified && (
        <span style={{ marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
          <Seal size={16} /> Verified
        </span>
      )}
    </div>
  );
}
