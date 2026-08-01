"use client";

// Shared building blocks for the desktop-native dashboard screens (≥1024px):
// DesktopHome, DesktopMarket, DesktopPortfolio, DesktopWallet, DesktopVera. Keeps
// the desktop surfaces one consistent system (cards, headers, stat tiles, table
// cells) instead of each screen inventing its own. Uses theme CSS vars only.
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/design";

export const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  boxShadow: "var(--shadow)",
};

export const iconButton: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  display: "grid",
  placeItems: "center",
  background: "var(--surface-2)",
  color: "var(--ink-2)",
  position: "relative",
};

// Table header / cell styles (desktop data tables).
export const th: CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  padding: "0 12px 10px",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};
export const td: CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid var(--line-2)",
  verticalAlign: "middle",
};

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...cardStyle, ...style }}>{children}</div>;
}

export function CardHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "16px 18px 12px",
        borderBottom: "1px solid var(--line-2)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em", color: "var(--ink)" }}>{title}</h2>
      {action}
    </div>
  );
}

export function ViewAll({ onClick, label = "View all" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500, color: "var(--primary)" }}>
      {label} <Icon name="chevR" size={15} style={{ color: "var(--primary)" }} />
    </button>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, background: "var(--surface-2)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--ink-3)" }}>{label}</div>
      <div
        className="tnum"
        style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em", marginTop: 4, color: tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--ink)" }}
      >
        {value}
      </div>
    </div>
  );
}

// The desktop screen header: a serif title with an optional eyebrow on the left,
// and a slot for actions on the right. Every desktop screen opens with this.
export function DeskHeader({ eyebrow, title, left, right }: { eyebrow?: string; title?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, minHeight: 44 }}>
      {left ?? (
        <div>
          {eyebrow && <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500 }}>{eyebrow}</div>}
          <h1 className="serif" style={{ margin: 0, fontSize: 24, letterSpacing: "-.01em" }}>{title}</h1>
        </div>
      )}
      {right && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{right}</div>}
    </header>
  );
}

// Standard scroll shell for a desktop screen: full content area, capped inner
// width, comfortable padding.
export function DeskShell({ children }: { children: ReactNode }) {
  return (
    <div className="deskscreen">
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "26px 32px 48px" }}>{children}</div>
    </div>
  );
}
