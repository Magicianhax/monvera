"use client";

// Persistent desktop side navigation (≥1024px) — Monvera Desktop design. A flat,
// full-height rail: collapsible logo, the Invest-with-Vera CTA, a Menu group, a
// Discover group, and mode-toggle + Settings pinned to the bottom. Visibility is
// CSS-driven (DESKTOP_CSS: `.sidenav` is display:none below 1024px), so this
// mounts on every screen but only paints on desktop — mobile is untouched.
import { useState } from "react";
import { MonveraIcon, MonveraWordmark } from "@/components/design";
import { useTheme } from "@/hooks/useTheme";
import { DIcon } from "@/components/lite/screens/deskKit";

type NavId = "home" | "market" | "portfolio" | "vera" | "wallet" | "scan" | "token" | "autopilot" | "activity" | "settings";

// Which nav item is highlighted for a given app screen. Sub-screens map to root.
function navFor(screen: string): NavId {
  switch (screen) {
    case "market": case "movers": case "notifications": case "screener": case "discover": case "asset": case "trade":
      return "market";
    case "portfolio": case "review": return "portfolio";
    case "vera": return "vera";
    case "wallet": case "send": case "sellall": case "selling": case "sold": return "wallet";
    case "scan": return "scan";
    case "token": case "tokendone": return "token";
    case "autopilot": return "autopilot";
    case "activity": return "activity";
    case "settings": case "help": return "settings";
    default: return "home";
  }
}

interface Item { id: NavId; label: string; icon: string; brand?: boolean }

const PRIMARY: Item[] = [
  { id: "home", icon: "house", label: "Home" },
  { id: "market", icon: "grid", label: "Market" },
  { id: "portfolio", icon: "pie", label: "Owned" },
  { id: "vera", icon: "planet", label: "Vera" },
  { id: "wallet", icon: "wallet", label: "Wallet" },
];
const SECONDARY: Item[] = [
  { id: "scan", icon: "camera", label: "Scan to Buy" },
  { id: "token", icon: "coin", label: "$MONVERA", brand: true },
  { id: "autopilot", icon: "sliders", label: "Autopilot" },
  { id: "activity", icon: "clock", label: "Activity" },
];

export interface SideNavProps {
  active: string;
  onNav: (target: string) => void;
}

const secLabel = (collapsed: boolean): React.CSSProperties => ({
  fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase",
  color: "var(--ink-3)", padding: "0 12px", margin: "18px 0 8px", display: collapsed ? "none" : "block",
});

export function SideNav({ active, onNav }: SideNavProps) {
  const current = navFor(active);
  const [collapsed, setCollapsed] = useState(false);
  const { colorMode, setColorMode } = useTheme();
  const dark = colorMode === "dark";

  const Row = ({ id, icon, label, brand, on, onClick }: Item & { on: boolean; onClick: () => void }) => (
    <button
      type="button"
      className={`sidenav-item${on ? " is-active" : ""}`}
      aria-current={on ? "page" : undefined}
      title={label}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 11, width: "100%",
        padding: collapsed ? "11px 0" : "10px 12px", justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 10, textAlign: "left", fontSize: 13.5,
        color: on ? "var(--primary)" : "var(--ink-2)", background: on ? "var(--primary-soft)" : "transparent",
        fontWeight: on ? 600 : 500,
      }}
    >
      <span style={{ flex: "0 0 22px", display: "grid", placeItems: "center" }}>
        {brand ? <MonveraIcon size={20} /> : <DIcon name={icon} size={22} stroke={on ? 2 : 1.8} />}
      </span>
      {!collapsed && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>}
    </button>
  );

  return (
    <nav
      className="sidenav scr"
      aria-label="Primary"
      data-collapsed={collapsed}
      style={{
        flex: `0 0 ${collapsed ? 74 : 236}px`, height: "100%", flexDirection: "column",
        background: "color-mix(in srgb, var(--surface) 88%, transparent)",
        borderRight: "1px solid var(--line)", padding: "16px 12px 14px",
        overflowY: "auto", overflowX: "hidden", transition: "flex-basis .22s cubic-bezier(.32,.72,0,1)",
      }}
    >
      {/* logo / collapse toggle */}
      <button
        type="button" className="navlogo" onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Expand" : "Collapse"} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, padding: "4px 8px", width: "100%", position: "relative" }}
      >
        {collapsed ? (
          <span className="logomark" style={{ display: "grid", placeItems: "center" }}><MonveraIcon size={24} /></span>
        ) : (
          <>
            <MonveraWordmark size={19} />
            <span style={{ marginLeft: "auto", color: "var(--ink-3)", display: "grid" }}><DIcon name="caretL" size={16} stroke={2.2} /></span>
          </>
        )}
      </button>

      {/* Invest CTA */}
      <button
        type="button" onClick={() => onNav("invest")} title="Invest with Vera"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 40,
          margin: "16px 0 14px", padding: collapsed ? "0" : "0 14px", border: "none", cursor: "pointer",
          borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: "var(--primary-ink)", background: "var(--hero-grad)",
          boxShadow: "0 3px 10px color-mix(in srgb, var(--primary) 26%, transparent), inset 0 1px 0 rgba(255,255,255,.4)",
        }}
      >
        <DIcon name="sparkle" size={16} /> {!collapsed && <span>Invest with Vera</span>}
      </button>

      <div style={secLabel(collapsed)}>Menu</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {PRIMARY.map((i) => <Row key={i.id} {...i} on={current === i.id} onClick={() => onNav(i.id)} />)}
      </div>

      <div style={secLabel(collapsed)}>Discover</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {SECONDARY.map((i) => <Row key={i.id} {...i} on={current === i.id} onClick={() => onNav(i.id)} />)}
      </div>

      <div style={{ flex: 1, minHeight: 16 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
        <Row id={"home" as NavId} icon={dark ? "sun" : "moon"} label={dark ? "Light mode" : "Dark mode"} on={false} onClick={() => setColorMode(dark ? "light" : "dark")} />
        <Row id="settings" icon="gear" label="Settings" on={current === "settings"} onClick={() => onNav("settings")} />
      </div>
    </nav>
  );
}
