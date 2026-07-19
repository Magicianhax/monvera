"use client";

// Monvera toast system — refined to the Emil standard:
//  • Transitions, not keyframes → interruptible. Rapid toasts swap content without
//    restarting the entrance from zero.
//  • Asymmetric timing: enter is a gentle ease-out slide+fade; exit is faster.
//  • Subsequent toasts (fired while one is already visible) skip the entrance
//    animation/delay — the content just swaps in place.
//  • Auto-dismiss timer PAUSES when the tab is hidden and resumes on return, so a
//    backgrounded toast doesn't silently expire.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";
import { useDesktopLayout } from "@/hooks/useDesktopLayout";

export interface ToastData {
  msg: ReactNode;
  icon?: IconName;
  /** key — bump to re-trigger the same message. */
  k?: number;
}

const VISIBLE_MS = 2600;

// ── Presentational toast ──────────────────────────────────────────────────────
// `firstShow` controls whether to animate the entrance (skipped when a toast is
// already on screen and we're just swapping content).
export function Toast({
  toast,
  onClear,
  firstShow = true,
  leaving = false,
}: {
  toast: ToastData | null;
  onClear: () => void;
  firstShow?: boolean;
  /** When true, the toast plays its (faster) exit transition before unmounting. */
  leaving?: boolean;
}) {
  // mount-shown gate so the entrance transition has a frame to start from.
  const [shown, setShown] = useState(false);
  // Desktop shell has no phone status bar to clear — the toast sits nearer the top.
  const { active: desktop } = useDesktopLayout();
  // remaining time bookkeeping for pause-on-hidden.
  const remaining = useRef(VISIBLE_MS);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // entrance
  useEffect(() => {
    if (!toast) {
      setShown(false);
      return;
    }
    if (firstShow) {
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(true);
  }, [toast, firstShow]);

  // auto-dismiss with pause-when-hidden
  useEffect(() => {
    if (!toast) return;
    remaining.current = VISIBLE_MS;

    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const arm = (ms: number) => {
      clearTimer();
      startedAt.current = Date.now();
      timer.current = setTimeout(onClear, ms);
    };
    const onVisibility = () => {
      if (document.hidden) {
        // pause: bank the remaining time.
        remaining.current = Math.max(remaining.current - (Date.now() - startedAt.current), 0);
        clearTimer();
      } else {
        arm(remaining.current);
      }
    };

    arm(remaining.current);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [toast, onClear]);

  if (!toast) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: desktop ? 20 : 54,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        zIndex: 90,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          maxWidth: desktop ? 420 : "84%",
          background: "var(--ink)",
          color: "var(--paper)",
          padding: "11px 16px",
          borderRadius: 6,
          boxShadow: "var(--shadow-lg)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          opacity: shown && !leaving ? 1 : 0,
          transform: shown && !leaving ? "translateY(0)" : "translateY(-14px)",
          // asymmetric: enter ~260ms ease-out; exit is faster (~170ms) so it leaves
          // promptly without feeling abrupt (see provider's 180ms unmount timer).
          transition: leaving
            ? "opacity .17s var(--ease-out), transform .17s var(--ease-out)"
            : "opacity .26s var(--ease-out), transform .26s var(--ease-out)",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 99,
            background: "var(--primary)",
            color: "var(--primary-ink)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <Icon name={toast.icon || "check"} size={14} stroke={2.6} />
        </span>
        {toast.msg}
      </div>
    </div>
  );
}

// ── Provider + hook ───────────────────────────────────────────────────────────
interface ToastContextValue {
  notify: (msg: ReactNode, icon?: IconName) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  // Track whether a toast is currently visible so the NEXT one skips its entrance.
  const visible = useRef(false);
  const [firstShow, setFirstShow] = useState(true);
  // Drives the exit transition: when set, the toast plays its leave animation
  // (faster than the entrance) before it actually unmounts.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: ReactNode, icon?: IconName) => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setLeaving(false);
    setFirstShow(!visible.current);
    visible.current = true;
    setToast({ msg, icon, k: Date.now() });
  }, []);

  // Begin the exit: animate out (asymmetric, faster than enter), then unmount.
  const clear = useCallback(() => {
    visible.current = false;
    setLeaving(true);
    leaveTimer.current = setTimeout(() => {
      setToast(null);
      setLeaving(false);
      leaveTimer.current = null;
    }, 180);
  }, []);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <Toast toast={toast} onClear={clear} firstShow={firstShow} leaving={leaving} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // No-op fallback so components don't crash if rendered outside a provider.
    return { notify: () => {} };
  }
  return ctx;
}
