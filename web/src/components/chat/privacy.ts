"use client";

// Hide-balances toggle — the turn-your-screen-toward-a-friend switch. One
// persisted device preference (localStorage, same policy as theme); every
// money figure on a hero surface routes through money() so a single tap
// blanks them all.
import { useSyncExternalStore } from "react";
import { usd } from "./chatKit";

const KEY = "mv.hideBalances";
let cache = false;
const subs = new Set<() => void>();

export function setHidden(v: boolean): void {
  cache = v;
  try {
    if (v) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: in-memory still applies this session */ }
  subs.forEach((f) => f());
}

export function useHidden(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => cache,
    () => cache,
  );
}

if (typeof window !== "undefined") {
  try { cache = localStorage.getItem(KEY) === "1"; } catch { /* default shown */ }
}

/** usd() that respects the privacy toggle. */
export function money(v: number, hidden: boolean): string {
  return hidden ? "••••" : usd(v);
}
