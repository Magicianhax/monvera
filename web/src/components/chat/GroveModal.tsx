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
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PIcon } from "./chatKit";
import { TokenLogo } from "@/components/lite/TokenLogo";
import fx from "@/components/lite/screens/conveyor.module.css";

// Children close through THIS, never through the raw onClose prop — the shell
// plays its 190ms de-materialize first, then unmounts. A Cancel button calling
// onClose directly would vanish the card while the X animates it, and the two
// paths must feel identical. `busy` rides along so every close affordance
// (scrim, Escape, X, Cancel) blocks in the same states — a signature prompt
// must never be stranded by ANY of the four.
const CloseCtx = createContext<{ close: () => void; busy: boolean }>({ close: () => {}, busy: false });
export const useGroveModalClose = () => useContext(CloseCtx).close;
const useModalBusy = () => useContext(CloseCtx).busy;

const subscribeNever = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

const GVM_PRESS_CSS = `
.gvm-press{transition:transform .16s ease-out}
.gvm-press:active{transform:scale(.97)}
@media (prefers-reduced-motion: reduce){.gvm-press{transition:none}.gvm-press:active{transform:none}}
`;

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

  // Portal to the app's THEME ROOT (.mvc / .mvm), not to where the panel
  // happens to mount: the Groves sheet ancestors carry transforms and
  // backdrop-filters, which hijack position:fixed — the modal centered inside
  // THAT box (off-screen-low on desktop) and its scrim never covered the whole
  // viewport, leaving the page behind it clickable. The root has no transform,
  // keeps the CSS variables, and keeps the `.mvm .fadein` bottom-sheet styles.
  // Hydration gate via useSyncExternalStore (the canonical isMounted): the
  // server snapshot is false, the client snapshot true, so the query runs
  // only in the browser and no effect-setState render cascade is needed.
  const mounted = useSyncExternalStore(subscribeNever, snapshotTrue, snapshotFalse);
  const host = mounted
    ? ((document.querySelector(".mvm[data-mode]") as HTMLElement | null) ??
        (document.querySelector(".mvc[data-mode]") as HTMLElement | null) ??
        document.body)
    : null;
  if (!host) return null;

  return createPortal(
    // The STAKING dialog's recipe, copied on purpose: a solid dark veil (no
    // backdrop blur games) and a card of --panel glass layered over opaque
    // --bg. --panel is a translucent GRADIENT in this theme — floating over a
    // scrim it has nothing behind it, so without the --bg base the page showed
    // straight through the one surface that must be legible.
    <div
      className={closing ? "fadein fadeout" : "fadein"}
      onClick={() => {
        if (!busy) close();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 96, background: "rgba(4,10,7,.72)", display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        className={closing ? "glassin glassout" : "glassin"}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: "100%", maxWidth: 420, maxHeight: "92%", overflowY: "auto", background: "var(--panel), var(--bg)", border: "1px solid var(--line)", borderRadius: 10 }}
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
    </div>,
    host,
  );
}

// ── shared modal furniture ───────────────────────────────────────────────────

/** In-flight view. With `symbols` it borrows the buy-conveyor's language —
 *  each basket name takes the spotlight in turn inside a spinning ring, with
 *  the queue below — honestly framed: one atomic transaction, so the cycle is
 *  a tour of what's settling together, never fake per-leg checkmarks. Without
 *  symbols it's the staking dialog's plain spinner beat. Either way the form
 *  disappears — a frozen form with a disabled button read as "nothing is
 *  happening". */
export function ModalWorking({ title, step, symbols }: { title: string; step?: string | null; symbols?: string[] }) {
  const [tick, setTick] = useState(0);
  const many = (symbols?.length ?? 0) > 0;
  useEffect(() => {
    if (!many) return;
    const t = setInterval(() => setTick((v) => v + 1), 800);
    return () => clearInterval(t);
  }, [many]);

  const cur = many ? symbols![tick % symbols!.length] : null;
  const leaving = many && tick > 0 ? symbols![(tick - 1) % symbols!.length] : null;

  return (
    <div style={{ textAlign: "center", padding: "18px 0 14px" }} role="status" aria-live="polite">
      {many ? (
        <>
          {/* spotlight: spinning conic ring + glow around the current name */}
          <div style={{ position: "relative", width: "100%", height: 116, overflow: "hidden" }}>
            {leaving && leaving !== cur && (
              <div key={`out-${tick}`} className={fx.flyOutRight} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                <TokenLogo symbol={leaving} size={64} />
              </div>
            )}
            <div key={`in-${tick}`} className={fx.flyInLeft} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <div style={{ position: "relative", width: 92, height: 92, display: "grid", placeItems: "center" }}>
                <span aria-hidden style={{ position: "absolute", inset: -8, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 30%, transparent), transparent 70%)", filter: "blur(13px)" }} />
                <span aria-hidden style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg, transparent 40deg, var(--primary))", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))", mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))", animation: "mvcspin 1.1s linear infinite" }} />
                {cur && <TokenLogo symbol={cur} size={64} />}
              </div>
            </div>
          </div>
          {/* the queue: everything settling in this ONE transaction */}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8, margin: "8px auto 0", maxWidth: 300 }}>
            {symbols!.map((s) => (
              <span key={s} style={{ width: 26, height: 26, borderRadius: "50%", opacity: s === cur ? 1 : 0.45, transform: s === cur ? "scale(1.15)" : "scale(1)", boxShadow: s === cur ? "0 0 0 2px var(--primary)" : "none", transition: "opacity .3s ease, transform .3s ease", lineHeight: 0 }}>
                <TokenLogo symbol={s} size={26} />
              </span>
            ))}
          </div>
        </>
      ) : (
        <span aria-hidden style={{ display: "inline-block", width: 42, height: 42, borderRadius: "50%", border: "3px solid var(--line)", borderTopColor: "var(--primary)", animation: "mvcspin .8s linear infinite" }} />
      )}
      <div className="serif" style={{ fontSize: 19, fontWeight: 500, marginTop: 14 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 5, minHeight: 18 }}>{step ?? "Working…"}</div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 12 }}>
        {many ? "One transaction: the whole basket settles together, or not at all." : "Keep this window open. This usually takes a few seconds."}
      </div>
    </div>
  );
}

/** Success check that POPS (overshoot scale + one green pulse ring) instead of
 *  appearing already-there — the moment deserves a beat. */
export function ModalSuccessIcon() {
  return (
    <>
      <style>{`
        @keyframes gvmpop{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
        @keyframes gvmring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--primary) 45%,transparent)}100%{box-shadow:0 0 0 28px transparent}}
        @media (prefers-reduced-motion: reduce){.gvmok{animation:none!important}}
      `}</style>
      <div
        className="gvmok"
        // House deceleration curve, no overshoot — the pulse ring carries the
        // celebratory beat; a bouncing check reads as toy, not receipt.
        style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--primary)", display: "grid", placeItems: "center", margin: "0 auto 12px", animation: "gvmpop .42s cubic-bezier(.22,1,.36,1) both, gvmring .9s ease-out .16s both" }}
      >
        <PIcon name="ph-check" size={30} weight="bold" style={{ color: "var(--primary-ink, #fff)" }} />
      </div>
    </>
  );
}

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
    <>
    <style>{GVM_PRESS_CSS}</style>
    <button
      className="gvm-press"
      onClick={close}
      style={{ display: "block", width: "100%", height: 46, marginTop: 16, borderRadius: 13, fontSize: 14, fontWeight: 700, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", cursor: "pointer" }}
    >
      Done
    </button>
    </>
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
      <style>{GVM_PRESS_CSS}</style>
      <button
        className="gvm-press"
        onClick={onCancel ?? close}
        disabled={busy}
        style={{ flex: "0 0 35%", height: 46, borderRadius: 13, fontSize: 13.5, fontWeight: 600, background: "transparent", border: "1px solid var(--line)", color: busy ? "var(--ink-3)" : "var(--ink-2)", cursor: busy ? "default" : "pointer" }}
      >
        Cancel
      </button>
      <button
        className="tnum gvm-press"
        onClick={onConfirm}
        disabled={disabled}
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
