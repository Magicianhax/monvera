"use client";

// Watchlist — a device-local set of starred tickers. Pure UI preference (no
// funds, no chain), stored in localStorage like the color style + hide-balance
// prefs, exposed through useSyncExternalStore so every star toggle updates all
// consumers (Market rows, asset header, Home card) instantly and across tabs.
import { useSyncExternalStore } from "react";

const KEY = "monvera:watchlist";
const listeners = new Set<() => void>();

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// A stable snapshot: only change identity when the contents actually change, so
// useSyncExternalStore doesn't loop.
let cache: string[] = read();
function refresh() {
  const next = read();
  if (next.length !== cache.length || next.some((s, i) => s !== cache[i])) cache = next;
}

function write(next: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / disabled — ignore */
  }
  cache = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      refresh();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive list of watched symbols (order = insertion, newest last). */
export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, () => cache, () => cache);
}

/** Reactive membership check for one symbol. */
export function useIsWatched(symbol: string): boolean {
  const list = useWatchlist();
  return list.includes(symbol);
}

/** Add/remove a symbol; returns the new watched state. */
export function toggleWatch(symbol: string): boolean {
  const cur = read();
  const has = cur.includes(symbol);
  write(has ? cur.filter((s) => s !== symbol) : [...cur, symbol]);
  return !has;
}
