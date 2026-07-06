"use client";

// Settings — grouped-card layout (identity pill, quiet section labels, solid
// rounded group cards with bare icons + inset separators). Wired to REAL state:
// profile identity from Privy + the account address, appearance from useTheme,
// color style from useColorStyle, and a real sign-out via useLogout.
import type { CSSProperties, ReactNode } from "react";
import { usePrivy, useLogout } from "@privy-io/react-auth";
import { Icon, type IconName } from "@/components/design";
import { useTheme } from "@/hooks/useTheme";
import { useColorStyle } from "@/hooks/useColorStyle";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { SelfCustodyProof } from "@/components/shared/SelfCustodyProof";
import { useHaptics, haptic } from "@/lib/haptics";
import { shortAddress } from "@/lib/format";
import { iconBtn } from "./primitives";

// ── Toggle — pill track (a switch is genuinely a pill), round knob ────────────
function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      style={{
        width: 50,
        height: 30,
        borderRadius: 99,
        flex: "none",
        padding: 3,
        background: on ? "var(--primary)" : "var(--surface-2)",
        boxShadow: on ? "none" : "inset 0 0 0 1px var(--line)",
        transition: "background .3s var(--ease-soft), box-shadow .3s var(--ease-soft)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.25)",
          transform: on ? "translateX(20px)" : "translateX(0)",
          transition: "transform .26s var(--ease-soft)",
        }}
      />
    </button>
  );
}

// ── Group row — bare icon · label · right control. Single line, no sub-copy. ──
function Row({
  icon,
  title,
  right,
  onClick,
  danger,
}: {
  icon: IconName;
  title: string;
  right?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  // Rows that *are* a control render a <button>. Rows that only host a control
  // (e.g. a toggle) must NOT be a button — a <button> inside a <button> is
  // invalid HTML and triggers a hydration error. Render a <div>.
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={onClick ? "row tap" : undefined}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "15px 16px",
        textAlign: "left",
        background: "none",
      }}
    >
      <Icon name={icon} size={21} stroke={1.9} style={{ color: danger ? "var(--neg)" : "var(--ink-2)", flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 15.5, letterSpacing: "-.005em", color: danger ? "var(--neg)" : "var(--ink)" }}>
        {title}
      </div>
      {right}
    </Tag>
  );
}

// Inset divider — starts after the icon column, like a native grouped list.
function Divider() {
  return <div aria-hidden style={{ height: 1, background: "var(--line-2)", marginLeft: 51 }} />;
}

// Quiet section label above each group.
const sectionLabel: CSSProperties = {
  padding: "26px 6px 8px",
  fontSize: 14,
  fontWeight: 500,
  color: "var(--ink-3)",
};

const chev = <Icon name="chevR" size={17} style={{ color: "var(--ink-3)" }} />;

export function SettingsScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { user } = usePrivy();
  const { logout } = useLogout();
  const { address } = useSmartAccount();
  const { colorMode, toggle } = useTheme();
  const { on: hapticsOn, supported: hapticsSupported, toggle: toggleHaptics } = useHaptics();
  const { colorStyle, setColorStyle, styles } = useColorStyle();

  // Identity — prefer a human handle, fall back to the account address.
  const identity =
    user?.email?.address ??
    user?.google?.email ??
    user?.twitter?.username ??
    (address ? shortAddress(address) : "");

  const darkOn = colorMode === "dark";

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header — centered title */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 style={{ margin: 0, flex: 1, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-.01em" }}>
          Settings
        </h1>
        {/* spacer mirrors the back button so the title stays optically centered */}
        <span style={{ width: 44, flex: "none" }} aria-hidden />
      </div>

      <div style={{ padding: "14px 22px 0" }}>
        {/* identity pill */}
        <div className="card" style={{ padding: "17px 18px", fontWeight: 500, fontSize: 15.5, letterSpacing: "-.005em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {identity || "—"}
        </div>

        {/* Account */}
        <div style={sectionLabel}>Account</div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <Row icon="wallet" title="Wallet" onClick={() => go("wallet")} right={chev} />
          <Divider />
          <Row icon="spark" title="Autopilot" onClick={() => go("autopilot")} right={chev} />
          <Divider />
          <Row icon="shield" title="Vera's track record" onClick={() => go("vera")} right={chev} />
          <Divider />
          <Row icon="receipt" title="Activity & receipts" onClick={() => go("activity")} right={chev} />
        </div>

        {/* Your money — self-custody proof */}
        <div style={sectionLabel}>Your money</div>
        <SelfCustodyProof />

        {/* App */}
        <div style={sectionLabel}>App</div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <Row icon="info" title="Help & FAQ" onClick={() => go("help")} right={chev} />
          <Divider />
          <Row
            icon="link"
            title="Follow @monvera_best"
            onClick={() => window.open("https://x.com/monvera_best", "_blank", "noopener")}
            right={<Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)" }} />}
          />
          {hapticsSupported && (
            <>
              <Divider />
              <Row
                icon="vibrate"
                title="Haptic feedback"
                right={<Toggle on={hapticsOn} onChange={toggleHaptics} label="Haptic feedback" />}
              />
            </>
          )}
        </div>

        {/* Appearance */}
        <div style={sectionLabel}>Appearance</div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <Row
            icon={darkOn ? "moon" : "sun"}
            title={darkOn ? "Dark mode" : "Light mode"}
            right={
              <Toggle
                on={darkOn}
                onChange={() => {
                  haptic.select();
                  toggle();
                }}
                label="Dark appearance"
              />
            }
          />
          <Divider />
          {/* color style — swatch row inside the group */}
          <div style={{ padding: "15px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 13 }}>
              <Icon name="eye" size={21} stroke={1.9} style={{ color: "var(--ink-2)", flex: "none" }} />
              <span style={{ fontWeight: 500, fontSize: 15.5, letterSpacing: "-.005em" }}>Color</span>
            </div>
            <div style={{ display: "flex", gap: 13, flexWrap: "wrap", paddingLeft: 35 }}>
              {styles.map((s) => {
                const active = s.key === colorStyle;
                return (
                  <button
                    key={s.key}
                    onClick={() => {
                      haptic.select();
                      setColorStyle(s.key);
                    }}
                    className="tap"
                    aria-label={s.name}
                    aria-pressed={active}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 11,
                        background: s.swatch,
                        boxShadow: active ? `0 0 0 2px var(--surface), 0 0 0 4px ${s.swatch}` : "inset 0 0 0 1px rgba(0,0,0,.08)",
                        display: "block",
                      }}
                    />
                    <span style={{ fontSize: 11.5, fontWeight: active ? 600 : 400, color: active ? "var(--ink)" : "var(--ink-3)" }}>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* sign out — its own group, centered */}
        <div style={{ marginTop: 26 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <button
              onClick={() => logout()}
              className="row tap"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "15px 16px",
                background: "none",
              }}
            >
              <Icon name="close" size={19} stroke={2} style={{ color: "var(--neg)", flex: "none" }} />
              <span style={{ fontWeight: 500, fontSize: 15.5, letterSpacing: "-.005em", color: "var(--neg)" }}>
                Sign out
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
