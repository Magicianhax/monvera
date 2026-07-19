"use client";

// Monvera surface + layout primitives — ported from the design handoff (components.jsx).
// BottomSheet, HoldingRow, Eyebrow, VerifiedBadge, Stat, SectionTitle, Confetti.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { AssetTile, type TileAsset } from "./Brand";
import { Sparkline } from "./Charts";
import { useDragDismiss } from "../../hooks/useDragDismiss";
import { useDesktopLayout } from "@/hooks/useDesktopLayout";

// ── Bottom sheet ────────────────────────────────────────────────────────────
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  // Keep the sheet mounted briefly after `open` flips false so the scrim can
  // fade out (exit faster than enter). `mounted` drives presence; `shown`
  // drives the open/closed visual state via data-open.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  // On the desktop shell the same sheet renders as a centered modal: no grab
  // handle, no drag-to-dismiss, fade+lift entrance instead of the drawer slide.
  const { active: desktop } = useDesktopLayout();

  // The sheet's scrim is `position: absolute; inset: 0`, so it anchors to the
  // nearest positioned ancestor. Rendered in place that is `.screen` — a SCROLL
  // container — so a tall sheet drifted with the scroll instead of sitting on the
  // bottom edge, uncovering the CTA beneath it. Portal into the phone frame, which
  // is the fixed-size positioned element the sheet is meant to cover.
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost((anchorRef.current?.closest(".stax") as HTMLElement | null) ?? null);
  }, []);

  // Drag-to-dismiss wired to the same close path; the drag animates the panel
  // off-screen itself, then calls onClose via onDismiss.
  const { ref, handlers } = useDragDismiss<HTMLDivElement>({ onDismiss: onClose });

  useEffect(() => {
    if (open) {
      setMounted(true);
      // next frame → animate in (avoids appearing-from-nothing on first paint).
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  // Desktop modals dismiss on Escape (drag-to-dismiss is the phone affordance).
  // onClose is the same guarded path the scrim uses, so busy-gated sheets stay put.
  useEffect(() => {
    if (!desktop || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [desktop, open, onClose]);

  // Always render the anchor so we can find the frame on first mount, even while
  // the sheet is closed.
  if (!mounted) return <span ref={anchorRef} aria-hidden style={{ display: "none" }} />;

  const sheet = (
    <div
      ref={scrimRef}
      onClick={onClose}
      data-open={shown ? "true" : "false"}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        background: "rgba(10,10,8,.4)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex",
        alignItems: desktop ? "center" : "flex-end",
        justifyContent: desktop ? "center" : undefined,
        padding: desktop ? 24 : undefined,
        opacity: shown ? 1 : 0,
        transition: "opacity .2s var(--ease-out)",
      }}
    >
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: desktop ? "min(480px, calc(100% - 48px))" : "100%",
          position: desktop ? "relative" : undefined,
          background: "var(--glass)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          borderRadius: desktop ? "var(--r-xl)" : "var(--r-xl) var(--r-xl) 0 0",
          boxShadow: "var(--glass-shadow), var(--glass-hi)",
          maxHeight: desktop ? "min(85%, 720px)" : "88%",
          overflowY: "auto",
          padding: desktop ? "18px 20px 20px" : "6px 20px calc(20px + env(safe-area-inset-bottom))",
          // entrance via transform (slides from edge); drag takes over via direct
          // style.transform writes, so we only set the initial open transition.
          // Desktop modal: fade + a small lift instead of the drawer slide.
          transform: desktop
            ? shown
              ? "none"
              : "translateY(12px) scale(.98)"
            : shown
              ? "translateY(0)"
              : "translateY(100%)",
          opacity: desktop && !shown ? 0 : 1,
          transition: desktop
            ? "opacity .22s var(--ease-out), transform .22s var(--ease-out)"
            : "transform .42s var(--ease-drawer)",
          // Mobile only: the drag gesture owns the panel. On desktop leaving this
          // unset keeps mouse-wheel scrolling alive inside the modal.
          touchAction: desktop ? undefined : "none",
        }}
      >
        {/* Real grab handle — wider hit area, the visible pill is the affordance.
            Phone-only: the desktop modal closes via X / scrim / Escape. */}
        {!desktop && (
          <div
            {...handlers}
            role="button"
            aria-label="Drag to dismiss"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "10px 0 12px",
              margin: "0 -20px",
              cursor: "grab",
              touchAction: "none",
            }}
          >
            <div
              style={{
                width: 40,
                height: 5,
                borderRadius: 99,
                background: "var(--line)",
              }}
            />
          </div>
        )}
        {/* Untitled sheets have no header row — on desktop float a close button
            so the modal always has a pointer-friendly dismiss. */}
        {desktop && !title && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 1,
              width: 34,
              height: 34,
              borderRadius: 99,
              background: "var(--surface-2)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-2)",
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
        {title && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h3 className="title-sm" style={{ margin: 0 }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="tap"
              style={{
                width: 34,
                height: 34,
                borderRadius: 99,
                background: "var(--surface-2)",
                display: "grid",
                placeItems: "center",
                color: "var(--ink-2)",
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );

  return (
    <>
      <span ref={anchorRef} aria-hidden style={{ display: "none" }} />
      {host ? createPortal(sheet, host) : sheet}
    </>
  );
}

// ── Blur-mask crossfade ───────────────────────────────────────────────────────
// Swaps between two states as ONE transform (blur + opacity + sub-pixel scale),
// so the eye reads a single morphing object rather than two overlapping layers.
// Used for Vera thinking → plan and morphing buttons. Interruptible (transitions,
// not keyframes). Layers are stacked absolutely; the wrapper sizes to whichever is
// shown so layout doesn't jump.
export interface CrossfadeProps {
  /** Which layer is active. */
  showFirst: boolean;
  first: ReactNode;
  second: ReactNode;
  /** Wrapper style (e.g. width for a morphing button). */
  style?: CSSProperties;
  className?: string;
}

export function Crossfade({ showFirst, first, second, style, className }: CrossfadeProps) {
  return (
    <div
      className={className}
      style={{ position: "relative", display: "grid", ...style }}
    >
      <div className="xfade-layer" data-show={showFirst ? "true" : "false"} style={{ gridArea: "1 / 1" }}>
        {first}
      </div>
      <div className="xfade-layer" data-show={showFirst ? "false" : "true"} style={{ gridArea: "1 / 1" }}>
        {second}
      </div>
    </div>
  );
}

// ── Holding / asset row ───────────────────────────────────────────────────────
export interface HoldingRowProps {
  asset: TileAsset & { day?: number; spark?: number[] };
  /** Right-aligned value (e.g. "$642.18"). Ignored when `right` is provided. */
  value?: ReactNode;
  /** Secondary line under the name. */
  sub?: ReactNode;
  /** Fully custom right-hand content. */
  right?: ReactNode;
  onClick?: () => void;
  dim?: boolean;
  showSpark?: boolean;
  /** Sparkline width in px — desktop tables pass a wider one. */
  sparkW?: number;
  /** Fixed pixel width for the right value column so desktop table rows align. */
  rightW?: number;
}

export function HoldingRow({
  asset,
  value,
  sub,
  right,
  onClick,
  dim,
  showSpark = true,
  sparkW = 64,
  rightW,
}: HoldingRowProps) {
  const day = asset.day ?? 0;
  const up = day >= 0;
  return (
    <button
      onClick={onClick}
      className={onClick ? "tap" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        width: "100%",
        padding: "12px 4px",
        textAlign: "left",
        background: "none",
        opacity: dim ? 0.5 : 1,
      }}
    >
      <AssetTile asset={asset} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 16.5, letterSpacing: "-.01em" }}>{asset.name}</div>
        {sub !== undefined && (
          <div
            style={{
              fontSize: 13.5,
              color: "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {showSpark && asset.spark && (
        // The spark owns its own flexible middle zone (splitting the free space
        // with the name block) so it reads centered in the row, not glued to the
        // price column.
        <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          <Sparkline data={asset.spark} w={sparkW} color={up ? "var(--pos)" : "var(--neg)"} />
        </div>
      )}
      <div
        style={{
          textAlign: "right",
          minWidth: rightW ?? 64,
          width: rightW,
          flex: rightW !== undefined ? "none" : undefined,
        }}
      >
        {right !== undefined ? (
          right
        ) : (
          <>
            <div className="tnum" style={{ fontWeight: 500, fontSize: 16 }}>
              {value}
            </div>
            <div
              className="tnum"
              style={{ fontSize: 13, fontWeight: 500, color: up ? "var(--pos)" : "var(--neg)" }}
            >
              {(up ? "+" : "") + day.toFixed(2)}%
            </div>
          </>
        )}
      </div>
    </button>
  );
}

// ── Eyebrow / small caps label ───────────────────────────────────────────────
export interface EyebrowProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function Eyebrow({ children, style }: EyebrowProps) {
  return (
    <div className="label-eyebrow" style={style}>
      {children}
    </div>
  );
}

// ── On-chain trust badge (plain words) ───────────────────────────────────────
export interface VerifiedBadgeProps {
  label?: string;
  onClick?: () => void;
}

// Monvera verification seal — the sage gradient check we use as the "verified /
// signed" mark everywhere (Vera's identity, trust badges, receipts). One shared
// element keeps the trust language consistent across the app.
export function Seal({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--hero-grad)",
        display: "grid",
        placeItems: "center",
        flex: "none",
        boxShadow: `0 2px ${Math.round(size / 3)}px color-mix(in srgb, var(--primary) 36%, transparent)`,
      }}
    >
      <Icon name="check" size={Math.round(size * 0.56)} stroke={3} style={{ color: "var(--primary-ink)" }} />
    </span>
  );
}

export function VerifiedBadge({ label = "Recorded & verifiable", onClick }: VerifiedBadgeProps) {
  return (
    <button
      onClick={onClick}
      className="tap"
      style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--ink)" }}
    >
      <Seal size={21} />
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      {onClick && <Icon name="chevR" size={15} style={{ color: "var(--ink-3)", marginLeft: -2 }} />}
    </button>
  );
}

// ── Small inline stat ────────────────────────────────────────────────────────
export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  accent?: string;
}

export function Stat({ label, value, accent }: StatProps) {
  return (
    <div style={{ flex: 1 }}>
      <div className="label-eyebrow" style={{ marginBottom: 5 }}>
        {label}
      </div>
      <div
        className="tnum"
        style={{
          fontSize: 19,
          fontWeight: 600,
          color: accent || "var(--ink)",
          letterSpacing: "-.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
export interface SectionTitleProps {
  children: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
}

export function SectionTitle({ children, action, onAction }: SectionTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        margin: "0 0 10px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-.02em" }}>
        {children}
      </h2>
      {action && (
        <button onClick={onAction} style={{ fontSize: 14, fontWeight: 500, color: "var(--primary)" }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── Confetti burst ────────────────────────────────────────────────────────────
export interface ConfettiProps {
  count?: number;
}

export function Confetti({ count = 26 }: ConfettiProps) {
  const colors = ["var(--primary)", "var(--accent)", "var(--pos)", "var(--ink)"];
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const ang = (Math.PI * 2 * i) / count + Math.random();
        const dist = 70 + Math.random() * 90;
        return {
          tx: Math.cos(ang) * dist,
          ty: Math.sin(ang) * dist - 30,
          r: Math.random() * 360,
          d: Math.random() * 0.15,
          c: colors[i % colors.length],
          sz: 6 + Math.random() * 6,
          round: Math.random() > 0.5,
        };
      }),
    [count],
  );
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {pieces.map((piece, i) => (
        <span
          key={i}
          style={
            {
              position: "absolute",
              top: "32%",
              left: "50%",
              width: piece.sz,
              height: piece.sz,
              background: piece.c,
              borderRadius: piece.round ? "50%" : 2,
              "--tx": `${piece.tx}px`,
              "--ty": `${piece.ty}px`,
              "--r": `${piece.r}deg`,
              animation: `confettiBurst 1.1s ${piece.d}s var(--ease) forwards`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export type { IconName };
