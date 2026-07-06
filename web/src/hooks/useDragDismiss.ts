"use client";

// useDragDismiss — hand-rolled, pointer-events drag for a bottom sheet.
//
// Playbook notes baked in:
//  • Tracks translateY by writing element.style.transform DIRECTLY (no CSS var on a
//    parent) so the drag is off-main-thread-friendly and never triggers React renders.
//  • Velocity-based dismiss: |velocity| > VELOCITY_DISMISS dismisses regardless of
//    distance; otherwise we fall back to a distance threshold.
//  • Increasing friction (rubber-band) when dragging UP past the resting position —
//    the sheet resists going above its open state.
//  • Pointer capture so the gesture keeps tracking outside the element.
//  • Ignores extra touch points (only the first active pointer drives the drag).
//  • Snap-back on release: 200ms ease-out. Dismiss: momentum-flavored ease-out, then
//    onDismiss() after the transition.
//  • Fully interruptible — grabbing mid-animation cancels the transition and resumes
//    from the current position.

import { useCallback, useRef } from "react";

export interface UseDragDismissOptions {
  /** Called once the sheet has animated off-screen. Parent should set open=false. */
  onDismiss: () => void;
  /** px/ms; flick faster than this dismisses regardless of distance. Default 0.11. */
  velocityDismiss?: number;
  /** Fraction of sheet height that, if exceeded on release, dismisses. Default 0.4. */
  distanceFraction?: number;
  /** Snap-back / settle duration in ms. Default 200. */
  snapMs?: number;
}

export interface UseDragDismissResult<T extends HTMLElement = HTMLDivElement> {
  /** Ref for the sheet panel — the element that translates. */
  ref: React.RefObject<T | null>;
  /** Spread onto the GRAB HANDLE (or the whole panel) to start a drag. */
  handlers: {
    onPointerDown: (e: React.PointerEvent<T>) => void;
  };
}

const DEFAULTS = {
  velocityDismiss: 0.11,
  distanceFraction: 0.4,
  snapMs: 200,
};

export function useDragDismiss<T extends HTMLElement = HTMLDivElement>(
  options: UseDragDismissOptions,
): UseDragDismissResult<T> {
  const { onDismiss } = options;
  const velocityDismiss = options.velocityDismiss ?? DEFAULTS.velocityDismiss;
  const distanceFraction = options.distanceFraction ?? DEFAULTS.distanceFraction;
  const snapMs = options.snapMs ?? DEFAULTS.snapMs;

  const ref = useRef<T | null>(null);

  // Mutable gesture state — refs so handlers stay referentially stable + never
  // trigger renders mid-drag.
  const activePointer = useRef<number | null>(null);
  const startY = useRef(0);
  const startTranslate = useRef(0);
  const currentTranslate = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);

  const setTransform = useCallback((y: number) => {
    const el = ref.current;
    if (!el) return;
    currentTranslate.current = y;
    el.style.transform = `translateY(${y}px)`;
  }, []);

  // Rubber-band resistance for over-drag past the resting (0) position.
  const damp = useCallback((y: number) => {
    if (y >= 0) return y;
    // dragging above rest: progressively resist (logarithmic-ish).
    return -Math.pow(-y, 0.78);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      const now = e.timeStamp || performance.now();
      const dy = e.clientY - startY.current;
      const next = damp(startTranslate.current + dy);
      // velocity from the most recent move sample
      const dt = now - lastT.current;
      if (dt > 0) velocity.current = (e.clientY - lastY.current) / dt;
      lastY.current = e.clientY;
      lastT.current = now;
      setTransform(next);
    },
    [damp, setTransform],
  );

  const endGesture = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const height = el.offsetHeight || 1;
    const translated = currentTranslate.current;
    const v = velocity.current;

    const flickDown = v > velocityDismiss;
    const draggedFar = translated > height * distanceFraction;
    const shouldDismiss = flickDown || draggedFar;

    if (shouldDismiss) {
      // momentum-flavored exit: project a bit past the bottom edge, ease-out.
      const exitMs = Math.min(Math.max(snapMs, height / Math.max(Math.abs(v), 0.4) / 2), 420);
      el.style.transition = `transform ${exitMs}ms cubic-bezier(0.32,0.72,0,1)`;
      // double-rAF so the transition picks up from the current transform.
      requestAnimationFrame(() => {
        el.style.transform = `translateY(${height + 40}px)`;
      });
      const done = () => {
        el.removeEventListener("transitionend", done);
        onDismiss();
      };
      el.addEventListener("transitionend", done);
    } else {
      // snap back to rest.
      el.style.transition = `transform ${snapMs}ms cubic-bezier(0.23,1,0.32,1)`;
      requestAnimationFrame(() => setTransform(0));
    }
  }, [distanceFraction, onDismiss, setTransform, snapMs, velocityDismiss]);

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      const el = ref.current;
      activePointer.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      try {
        el?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* pointer may already be released */
      }
      endGesture();
    },
    [endGesture, onPointerMove],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<T>) => {
      // ignore extra touch points / non-primary buttons
      if (activePointer.current !== null) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const el = ref.current;
      if (!el) return;

      activePointer.current = e.pointerId;
      startY.current = e.clientY;
      lastY.current = e.clientY;
      lastT.current = e.timeStamp || performance.now();
      velocity.current = 0;
      // resume from wherever the sheet currently sits (interruptible).
      startTranslate.current = currentTranslate.current;

      // cancel any in-flight settle animation so the grab is immediate.
      el.style.transition = "none";
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  return { ref, handlers: { onPointerDown } };
}
