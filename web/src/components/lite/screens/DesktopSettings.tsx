"use client";

// Desktop Settings — Monvera Desktop design. Appearance (light/dark + the six
// brand accents), account (address + export key), and about. Wired to the real
// theme + color-style + account hooks the mobile Settings uses.
import { useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useColorStyle } from "@/hooks/useColorStyle";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { shortAddress } from "@/lib/format";
import { ExportKey } from "./ExportKey";
import { DIcon, Panel } from "./deskKit";

type Go = (screen: string, params?: Record<string, unknown>) => void;

export function DesktopSettings({ go }: { go: Go }) {
  const { colorMode, setColorMode } = useTheme();
  const { colorStyle, setColorStyle, styles } = useColorStyle();
  const { address } = useSmartAccount();
  const [copied, setCopied] = useState(false);

  const light = colorMode === "light";
  const copy = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };

  const modeBtn = (isOn: boolean): React.CSSProperties => ({
    height: 36, padding: "0 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6,
    background: isOn ? "var(--surface)" : "transparent", color: isOn ? "var(--ink)" : "var(--ink-3)", boxShadow: isOn ? "var(--shadow)" : "none",
  });

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 760, margin: "0 auto", padding: "28px 32px 60px" }}>
        <h1 className="serif" style={{ margin: "0 0 22px", fontSize: 27 }}>Settings</h1>

        {/* Appearance */}
        <Panel style={{ padding: "20px 22px", marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 14.5, fontWeight: 600 }}>Appearance</h2>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div><div style={{ fontSize: 14.5, fontWeight: 500 }}>Theme</div><div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Light and dark are both first-class.</div></div>
            <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: 999, padding: 4, gap: 2 }}>
              <button onClick={() => setColorMode("light")} style={modeBtn(light)}><DIcon name="sun" size={16} /> Light</button>
              <button onClick={() => setColorMode("dark")} style={modeBtn(!light)}><DIcon name="moon" size={16} /> Dark</button>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 18 }}>
            <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 3 }}>Brand color</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 14 }}>Pick the accent that carries every action.</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {styles.map((s) => {
                const on = colorStyle === s.key;
                return (
                  <button key={s.key} onClick={() => setColorStyle(s.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 46, height: 46, borderRadius: "50%", background: s.swatch, boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${on ? "var(--primary)" : "var(--line)"}`, display: "grid", placeItems: "center", color: "#fff" }}>
                      {on && <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* Account */}
        <Panel style={{ padding: "8px 22px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <DIcon name="wallet" size={20} style={{ color: "var(--ink-2)" }} />
              <div><div style={{ fontSize: 14.5, fontWeight: 500 }}>Wallet address</div><div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{address ? shortAddress(address) : "—"}</div></div>
            </div>
            <button onClick={copy} className="desk-chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: copied ? "var(--pos)" : "var(--ink-2)", fontSize: 12.5, fontWeight: 600 }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div style={{ padding: "10px 0" }}><ExportKey /></div>
        </Panel>

        {/* About */}
        <Panel style={{ padding: "8px 22px" }}>
          <button onClick={() => go("vera")} className="desk-row" style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "16px 0", borderBottom: "1px solid var(--line-2)", textAlign: "left" }}>
            <DIcon name="planet" size={20} style={{ color: "var(--ink-2)" }} />
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 500 }}>About Vera</span>
            <DIcon name="caretR" size={16} stroke={2.2} style={{ color: "var(--ink-3)" }} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0" }}>
            <DIcon name="shield" size={20} style={{ color: "var(--ink-2)" }} />
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 500 }}>Monvera</span>
            <span className="tnum" style={{ fontSize: 13, color: "var(--ink-3)" }}>desktop</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
