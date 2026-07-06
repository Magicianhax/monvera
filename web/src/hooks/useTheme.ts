"use client";

// Light/dark mode for the Soft theme, persisted in localStorage (default DARK).
// SSR-safe via useSyncExternalStore: server snapshot is "dark", client reads
// localStorage. The chosen value is meant to be applied as the
// `data-mode` attribute on the `.stax` wrapper (see globals.css).
import { useCallback, useSyncExternalStore } from "react";

export type ColorMode = "light" | "dark";
const KEY = "monvera:theme";
const LEGACY_KEY = "stax:theme"; // pre-rebrand key, read once as fallback

const listeners = new Set<() => void>();

function read(): ColorMode {
  try {
    const stored = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function write(mode: ColorMode) {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // ignore (private mode, etc.)
  }
  listeners.forEach((cb) => cb());
}

export function useTheme(): {
  colorMode: ColorMode;
  setColorMode: (m: ColorMode) => void;
  toggle: () => void;
} {
  const colorMode = useSyncExternalStore(
    subscribe,
    read,
    () => "dark" as ColorMode,
  );
  const setColorMode = useCallback((m: ColorMode) => write(m), []);
  const toggle = useCallback(
    () => write(colorMode === "light" ? "dark" : "light"),
    [colorMode],
  );
  return { colorMode, setColorMode, toggle };
}
