"use client";

// Settings popup — the "Monvera Chat" design's settings overlay (design L547-560
// + script L799-802), wired real: light/dark via useTheme, the account address
// (+ copy) via useSmartAccount, and private-key export through Privy's own
// secure export modal (the classic <ExportKey/> can't drop in here — its
// BottomSheet portals into the `.stax` shell — so this uses the same
// useExportWallet mechanics behind an inline warning gate). Glass panels keep
// the exact style={{ background: "var(--panel)", ... }} idiom.
import { useCallback, useEffect, useRef, useState } from "react";
import { useExportWallet, useLogout, usePrivy } from "@privy-io/react-auth";
import { useTheme } from "@/hooks/useTheme";
import { useAvatar, setAvatar, avatarCss, fileToAvatar, AVATAR_PRESETS } from "./avatar";
import { FAQ } from "@/lib/faq";
import { useColorStyle } from "@/hooks/useColorStyle";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { shortAddress } from "@/lib/format";
import { Info } from "@phosphor-icons/react";
import { useHaptics } from "@/lib/haptics";
import { PIcon, type ChatNav } from "./chatKit";

const eyebrow: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" };

export function SettingsPopup({ onClose, nav }: { onClose: () => void; nav?: ChatNav }) {
  const { colorMode, setColorMode } = useTheme();
  const avatar = useAvatar();
  const { colorStyle, setColorStyle, styles } = useColorStyle();
  const { address } = useSmartAccount();
  const wallet = useActiveWallet();
  const { exportWallet } = useExportWallet();
  const { logout } = useLogout();
  const { user } = usePrivy();
  const { on: hapticsOn, supported: hapticsSupported, toggle: toggleHaptics } = useHaptics();
  // Human identity — handle first, address as fallback (classic app parity).
  const identity = user?.email?.address ?? user?.google?.email ?? user?.twitter?.username ?? (address ? shortAddress(address) : "");
  const [signingOut, setSigningOut] = useState(false);

  // Exit mirrors the entrance: panel de-materializes, scrim fades, then unmount.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 190);
  }, [onClose]);

  const [copied, setCopied] = useState(false);
  // Export is a two-step: arm (read the warning) → reveal (Privy's secure modal).
  const [armed, setArmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The mandatory acknowledgement the old export flow had: reveal stays
  // disabled until the user actively confirms they understand the stakes.
  const [exportAck, setExportAck] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Bring-your-own-wallet users have no embedded key for us to export.
  const canExport = !!wallet && wallet.walletClientType === "privy";

  const copyAddr = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // clipboard unavailable — the short address stays visible
    }
    setCopied(true);
  };

  const reveal = async () => {
    if (!wallet?.address || exporting) return;
    setExporting(true);
    try {
      // Privy decrypts and shows the key in ITS OWN iframe — Monvera never sees it.
      await exportWallet({ address: wallet.address });
      setArmed(false);
    } catch {
      // user closed Privy's modal — nothing to do
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Selected chip is SOLID --bg (iOS segmented-control style) — glass-on-glass
  // inside the modal would nest backdrop blurs.
  const pill = (on: boolean): React.CSSProperties => ({
    height: 34, padding: "0 14px", borderRadius: 999, fontSize: 13, fontWeight: 600,
    background: on ? "var(--bg)" : "transparent", color: on ? "var(--ink)" : "var(--ink-3)",
    boxShadow: on ? "0 1px 4px rgba(12,32,20,.14)" : "none",
    display: "inline-flex", alignItems: "center", gap: 5,
  });

  return (
    <div
      className={closing ? "fadein fadeout" : "fadein"}
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(8,14,10,.22)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        className={closing ? "glassin glassout" : "glassin"}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 760, background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 55%), var(--panel), var(--bg)", backdropFilter: "blur(14px) saturate(170%)", WebkitBackdropFilter: "blur(14px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 22, boxShadow: "0 20px 60px rgba(8,20,12,.3)", overflow: "hidden" }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}>
              <PIcon name="ph-gear-six" size={17} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Settings</span>
          </div>
          <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>

        <div className="scr" style={{ padding: "18px 22px", maxHeight: "78vh", overflowY: "auto" }}>
          {/* who's signed in */}
          {identity && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 13, background: "var(--panel-2)", marginBottom: 16, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <PIcon name="ph-seal-check" size={16} weight="fill" style={{ color: "var(--primary)", flexShrink: 0 }} /> {identity}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", columnGap: 28, alignItems: "start" }}>
          <div>
          {/* shortcuts (classic app parity) */}
          {nav && (
            <>
              <div style={{ ...eyebrow, marginBottom: 4 }}>Shortcuts</div>
              {([["ph-wallet", "Wallet", "wallet"], ["ph-sliders-horizontal", "Autopilot", "autopilot"], ["ph-seal-check", "Vera's track record", "vera"], ["ph-clock-counter-clockwise", "Activity & receipts", "activity"]] as const).map(([icon, title, target], i) => (
                <button key={target} onClick={() => { nav.openCanvas(target); close(); }} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", padding: "11px 0", borderBottom: i === 3 ? "1px solid var(--line-2)" : "none", color: "var(--ink)" }}>
                  <PIcon name={icon} size={19} style={{ color: "var(--ink-2)" }} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{title}</span>
                  <PIcon name="ph-caret-right" size={14} weight="bold" style={{ color: "var(--ink-3)" }} />
                </button>
              ))}
              <div style={{ height: 14 }} />
            </>
          )}

          {/* appearance */}
          <div style={{ ...eyebrow, marginBottom: 10 }}>Appearance</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 14 }}>Theme</span>
            <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 999, padding: 3, gap: 2 }}>
              <button onClick={() => setColorMode("light")} style={pill(colorMode === "light")}>
                <PIcon name="ph-sun" size={15} />Light
              </button>
              <button onClick={() => setColorMode("dark")} style={pill(colorMode === "dark")}>
                <PIcon name="ph-moon" size={15} />Dark
              </button>
            </div>
          </div>
          {/* your avatar — shown on your side of the chat; a device preference,
              stored locally, never uploaded anywhere */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14 }}>Your avatar</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* default */}
                <button
                  onClick={() => setAvatar({ kind: "default" })}
                  title="Default"
                  style={{ width: 30, height: 30, borderRadius: "50%", background: avatarCss({ kind: "default" }), boxShadow: avatar.kind === "default" ? "0 0 0 2px var(--primary)" : "inset 0 0 0 1px var(--line)", flex: "none" }}
                />
                {AVATAR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setAvatar({ kind: "preset", value: p.id })}
                    title={p.id}
                    style={{ width: 30, height: 30, borderRadius: "50%", background: p.css, boxShadow: avatar.kind === "preset" && avatar.value === p.id ? "0 0 0 2px var(--primary)" : "inset 0 0 0 1px var(--line)", flex: "none" }}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              {avatar.kind === "upload" && avatar.value ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar.value} alt="Your avatar" width={34} height={34} style={{ borderRadius: "50%", objectFit: "cover", boxShadow: "0 0 0 2px var(--primary)" }} />
              ) : null}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 12.5, fontWeight: 650, cursor: "pointer" }}>
                <PIcon name="ph-upload-simple" size={14} weight="bold" style={{ color: "var(--primary)" }} />
                {avatar.kind === "upload" ? "Change photo" : "Upload a photo"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void fileToAvatar(f).then((dataUrl) => setAvatar({ kind: "upload", value: dataUrl })).catch(() => {});
                    e.target.value = "";
                  }}
                />
              </label>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Stays on this device — never uploaded.</span>
            </div>
          </div>
          {/* color style — recolors the aurora + brand accents everywhere */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 14 }}>Color</span>
            <div style={{ display: "flex", gap: 9 }}>
              {styles.map((st) => {
                const on = st.key === colorStyle;
                return (
                  <button key={st.key} onClick={() => setColorStyle(st.key)} aria-label={st.name} aria-pressed={on} title={st.name} style={{ width: 26, height: 26, borderRadius: 9, background: st.swatch, boxShadow: on ? `0 0 0 2px var(--bg), 0 0 0 4px ${st.swatch}` : "inset 0 0 0 1px rgba(0,0,0,.12)", flex: "none" }} />
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 14 }}>Vera&apos;s voice</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600 }}>Warm &amp; human</span>
          </div>

          </div>
          <div>
          {/* app (classic parity: help, follow, haptics) */}
          <div style={{ ...eyebrow, margin: "16px 0 4px" }}>App</div>
          {/* help lives IN the app again: plain-language answers, expandable */}
          <button onClick={() => setHelpOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", padding: "11px 0", borderBottom: "1px solid var(--line-2)", color: "var(--ink)" }}>
            <PIcon name="ph-lightbulb" size={19} style={{ color: "var(--ink-2)" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Help</span>
            <PIcon name="ph-caret-down" size={14} weight="bold" style={{ color: "var(--ink-3)", transform: helpOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {helpOpen && (
            <div style={{ padding: "6px 0 10px", borderBottom: "1px solid var(--line-2)" }}>
              {FAQ.map((f) => (
                <details key={f.q} style={{ padding: "6px 0" }}>
                  <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", listStyle: "none" }}>{f.q}</summary>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 4 }}>{f.a}</div>
                </details>
              ))}
              <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12 }}>
                <a href="mailto:support@monvera.best" style={{ color: "var(--primary)", fontWeight: 600 }}>support@monvera.best</a>
                <a href="https://docs.monvera.best" target="_blank" rel="noreferrer" style={{ color: "var(--ink-3)" }}>Full docs</a>
              </div>
            </div>
          )}
          <a href="https://x.com/monvera_best" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: hapticsSupported ? "none" : "1px solid var(--line-2)", color: "var(--ink)", textDecoration: "none" }}>
            <PIcon name="ph-x-logo" size={19} style={{ color: "var(--ink-2)" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Follow @monvera_best</span>
            <PIcon name="ph-arrow-square-out" size={14} style={{ color: "var(--ink-3)" }} />
          </a>
          {hapticsSupported && (
            <button onClick={toggleHaptics} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", padding: "11px 0", borderBottom: "1px solid var(--line-2)", color: "var(--ink)" }}>
              <PIcon name="ph-hand-tap" size={19} style={{ color: "var(--ink-2)" }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Haptic feedback</span>
              <span style={{ width: 42, height: 25, borderRadius: 999, padding: 3, background: hapticsOn ? "var(--primary)" : "var(--panel-2)", transition: "background .18s ease-out", flexShrink: 0 }}>
                <span style={{ display: "block", width: 19, height: 19, borderRadius: "50%", background: "#fff", transform: hapticsOn ? "translateX(17px)" : "none", transition: "transform .18s ease-out", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
              </span>
            </button>
          )}

          {/* account */}
          <div style={{ ...eyebrow, margin: "16px 0 4px" }}>Account</div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
            <PIcon name="ph-wallet" size={19} style={{ color: "var(--ink-2)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Wallet</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{address ? shortAddress(address) : "Not signed in"}</div>
            </div>
            {address && (
              <button onClick={() => void copyAddr()} style={{ flex: "none", height: 30, padding: "0 12px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: "var(--panel-2)", color: "var(--ink)" }}>
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
          </div>

          {canExport ? (
            <>
              <button
                onClick={() => setArmed((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", width: "100%", textAlign: "left", borderBottom: armed ? "none" : "1px solid var(--line-2)" }}
              >
                <PIcon name="ph-lock-key" size={19} style={{ color: "var(--ink-2)" }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>Export private key</span>
                <PIcon name="ph-caret-right" size={15} weight="bold" style={{ color: "var(--ink-3)", transform: armed ? "rotate(90deg)" : "none" }} />
              </button>
              {armed && (
                <div style={{ background: "color-mix(in srgb,var(--neg) 9%,transparent)", border: "1px solid color-mix(in srgb,var(--neg) 25%,transparent)", borderRadius: 12, padding: "12px 13px", margin: "0 0 10px", textAlign: "left" }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.55 }}>
                    Anyone who sees this key can take everything in your account, and no one can undo that.
                    Monvera never sees it; your wallet provider reveals it in a secure window. Never paste it
                    into a website, a chat, or a screen-share. Real staff will never ask for it. There is no
                    support line for a stolen key, and we cannot recover it if you lose it.
                  </div>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={exportAck} onChange={(e) => setExportAck(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--neg)" }} />
                    <span style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.5 }}>I understand no one can undo a leaked key.</span>
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => void reveal()}
                      disabled={exporting || !exportAck}
                      style={{ flex: 1, height: 36, borderRadius: 10, fontSize: 12.5, fontWeight: 700, background: "var(--neg)", color: "#fff", opacity: exporting || !exportAck ? 0.6 : 1 }}
                    >
                      {exporting ? "Opening…" : "Reveal my key"}
                    </button>
                    <button onClick={() => setArmed(false)} style={{ height: 36, padding: "0 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: "var(--panel-2)", color: "var(--ink-2)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
              <PIcon name="ph-lock-key" size={19} style={{ color: "var(--ink-2)" }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Export private key</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Monvera accounts only</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
            <Info size={19} weight="duotone" style={{ color: "var(--ink-2)" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Version</span>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Monvera · chat</span>
          </div>

          </div>
          </div>
          {/* sign out — self-custody: logging out just drops the session, funds stay in the wallet */}
          <button
            onClick={async () => {
              if (signingOut) return;
              setSigningOut(true);
              try {
                await logout();
              } finally {
                setSigningOut(false);
              }
            }}
            disabled={signingOut}
            style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", padding: "14px 12px", marginTop: 12, borderRadius: 12, background: "color-mix(in srgb,var(--neg) 8%,transparent)", color: "var(--neg)", opacity: signingOut ? 0.6 : 1 }}
          >
            <PIcon name="ph-sign-out" size={19} style={{ color: "var(--neg)" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
          <div style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
            Signing out only ends this session. Your keys and funds stay in your self-custody wallet.
          </div>
        </div>
      </div>
    </div>
  );
}
