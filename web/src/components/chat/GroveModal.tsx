"use client";

// GroveModal — the shell both Grove action popups (buy, exit) render inside.
//
// This is the PaySheet idiom verbatim, on purpose: scrim + glass card with the
// house fadein/glassin classes, 190ms de-materialize before unmount, and the
// mobile bottom-sheet behavior comes FREE from the `.mvm .fadein` overrides in
// CHAT_THEME_CSS (full-width card, top-radius only, slide-up). Forking the
// animation values (Emil says 0.97/300ms, house says 0.94/340ms) would buy a
// 40ms delta at the cost of this being the one modal in the app that moves
// differently, so it reuses the house motion exactly.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PIcon } from "./chatKit";

// Children close through THIS, never through the raw onClose prop — the shell
// plays its 190ms de-materialize first, then unmounts. A Cancel button calling
// onClose directly would vanish the card while the X animates it, and the two
// paths must feel identical. `busy` rides along so every close affordance
// (scrim, Escape, X, Cancel) blocks in the same states — a signature prompt
// must never be stranded by ANY of the four.
const CloseCtx = createContext<{ close: () => void; busy: boolean }>({ close: () => {}, busy: false });
export const useGroveModalClose = () => useContext(CloseCtx).close;
const useModalBusy = () => useContext(CloseCtx).busy;

export function GroveModal({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** While true the scrim and Escape stop closing — never strand a signature. */
  busy?: boolean;
  children: ReactNode;
}) {
  // Exit mirrors the entrance: card de-materializes, scrim fades, then unmount.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 190);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close]);

  return (
    <div
      className={closing ? "fadein fadeout" : "fadein"}
      onClick={() => {
        if (!busy) close();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 96, background: "rgba(8,14,10,.22)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        className={closing ? "glassin glassout" : "glassin"}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: "100%", maxWidth: 380, maxHeight: "92%", overflowY: "auto", background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 55%),var(--panel)", backdropFilter: "blur(14px) saturate(170%)", WebkitBackdropFilter: "blur(14px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 22, boxShadow: "0 20px 60px rgba(8,20,12,.3)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 20px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
          <button
            onClick={() => {
              if (!busy) close();
            }}
            aria-label="Close"
            aria-disabled={busy}
            style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)", opacity: busy ? 0.4 : 1, cursor: busy ? "default" : "pointer" }}
          >
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>
        <div style={{ padding: "16px 20px 18px" }}>
          <CloseCtx.Provider value={{ close, busy }}>{children}</CloseCtx.Provider>
        </div>
      </div>
    </div>
  );
}

// ── shared modal furniture ───────────────────────────────────────────────────

/** Bordered sub-card: the unit the modal body is built from. */
export function ModalCard({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: 14, padding: "12px 14px", background: "var(--panel-2)", ...style }}>
      {children}
    </div>
  );
}

/** One receipt row: label left, mono value right. */
export function ReceiptRow({
  k,
  v,
  muted,
  strong,
  color,
}: {
  k: ReactNode;
  v: ReactNode;
  muted?: boolean;
  strong?: boolean;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line-2)" }}>
      <span style={{ fontSize: 12.5, color: muted ? "var(--ink-3)" : "var(--ink-2)" }}>{k}</span>
      <span className="mono" style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: strong ? 700 : 500, color: color ?? (muted ? "var(--ink-3)" : "var(--ink)"), textAlign: "right" }}>
        {v}
      </span>
    </div>
  );
}

/** Full-width neutral Done button for success states; animated close. */
export function ModalDoneButton() {
  const close = useGroveModalClose();
  return (
    <button
      onClick={close}
      style={{ display: "block", width: "100%", height: 46, marginTop: 16, borderRadius: 13, fontSize: 14, fontWeight: 700, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", cursor: "pointer" }}
    >
      Done
    </button>
  );
}

/** The quiet custody line above the buttons. */
export function TrustCaption({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "var(--ink-3)", margin: "12px 0 10px" }}>
      <PIcon name="ph-shield-check" size={13} /> {children}
    </div>
  );
}

/** Cancel (ghost) + confirm (the modal's only green). Cancel goes through the
 *  shell's animated close by default. */
export function ModalButtons({
  confirmLabel,
  onConfirm,
  onCancel,
  disabled,
  busyLabel,
}: {
  confirmLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  busyLabel?: string | null;
}) {
  const close = useGroveModalClose();
  const busy = useModalBusy();
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button
        onClick={onCancel ?? close}
        disabled={busy}
        style={{ flex: "0 0 35%", height: 46, borderRadius: 13, fontSize: 13.5, fontWeight: 600, background: "transparent", border: "1px solid var(--line)", color: busy ? "var(--ink-3)" : "var(--ink-2)", cursor: busy ? "default" : "pointer" }}
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className="tnum"
        style={{
          flex: 1,
          height: 46,
          borderRadius: 13,
          fontSize: 14,
          fontWeight: 700,
          background: disabled ? "var(--line)" : "linear-gradient(180deg,var(--primary-2),var(--primary))",
          border: "1px solid color-mix(in srgb,var(--primary) 70%,#000 8%)",
          color: disabled ? "var(--ink-3)" : "#fff",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {busyLabel ?? confirmLabel}
      </button>
    </div>
  );
}
