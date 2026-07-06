"use client";

// Tactile feedback for the moments that matter. `navigator.vibrate` is the only
// broadly available web haptics primitive (Android Chrome / supporting PWAs);
// iOS Safari doesn't implement it, so every call no-ops gracefully there.
// Gated on a user preference (Settings -> Haptics) and kept deliberately sparse —
// short buzzes on key moments only, never on every tap (haptic fatigue is real).
import { useEffect, useState } from "react";

const KEY = "monvera:haptics";
const LEGACY_KEY = "stax:haptics"; // pre-rebrand key, read as fallback

export function hapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function enabled(): boolean {
  if (!hapticsSupported()) return false;
  try {
    return (localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)) !== "off";
  } catch {
    return true;
  }
}

function fire(pattern: number | number[]) {
  if (!enabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // vibrate can throw if the gesture context disallows it; ignore.
  }
}

// Named intents. Keep durations short — long buzzes feel cheap.
export const haptic = {
  select: () => fire(6), // tab change, chip, toggle
  light: () => fire(10), // copy, light confirm
  medium: () => fire(16), // committing money (buy / invest)
  success: () => fire([14, 38, 26]), // investment placed
  warning: () => fire([20, 60, 20]),
};

export function setHaptics(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage unavailable; preference is in-memory for this session only
  }
}

// Hook for the Settings toggle.
export function useHaptics() {
  const [on, setOn] = useState(true);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(hapticsSupported());
    try {
      setOn((localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)) !== "off");
    } catch {
      /* default on */
    }
  }, []);
  const toggle = () => {
    setOn((prev) => {
      const next = !prev;
      setHaptics(next);
      if (next) haptic.select(); // confirm the new "on" state with a tick
      return next;
    });
  };
  return { on, supported, toggle };
}
