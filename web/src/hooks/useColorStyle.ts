"use client";

// Chosen Monvera color style, persisted in localStorage. Mirrors useTheme:
// SSR-safe via useSyncExternalStore (server + first client paint = the default),
// so the injected <style> is present from the very first render (no color flash).
import { useCallback, useSyncExternalStore } from "react";
import { COLOR_STYLES, DEFAULT_COLOR, colorStyleByKey } from "@/lib/colorStyles";

const KEY = "monvera:color";
const listeners = new Set<() => void>();

function read(): string {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored && COLOR_STYLES.some((s) => s.key === stored) ? stored : DEFAULT_COLOR;
  } catch {
    return DEFAULT_COLOR;
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

function write(key: string) {
  try {
    window.localStorage.setItem(KEY, key);
  } catch {
    /* ignore (private mode, etc.) */
  }
  listeners.forEach((cb) => cb());
}

export function useColorStyle() {
  const colorStyle = useSyncExternalStore(subscribe, read, () => DEFAULT_COLOR);
  const setColorStyle = useCallback((key: string) => write(key), []);
  return { colorStyle, setColorStyle, styles: COLOR_STYLES, current: colorStyleByKey(colorStyle) };
}
