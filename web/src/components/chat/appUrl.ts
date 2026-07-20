// Two-way sync between the app's view state and the URL, so a refresh (or a
// shared link) lands on the same page instead of resetting to the menu.
//
//   /app                    → home menu
//   /app?tab=chat           → the conversation
//   /app?tab=groves         → Groves shelf
//   /app?tab=groves&id=x    → a Grove detail page
//   /app?tab=<canvas>       → a canvas (portfolio, market, wallet, token, …)
//   /app?tab=holding&sym=X  → one holding's canvas
//
// Every view change pushes a history entry, so the browser's back button walks
// back through the app (canvas → chat → menu) instead of leaving it — the
// shells listen for popstate and re-apply the URL. Writes that merely
// normalize the current view (initial load) replace instead. The legacy
// ?grove=<id>&auto=1 deep link keeps working (handled in the shells before
// this runs).

const CANVASES = new Set([
  "portfolio", "market", "wallet", "token", "autopilot", "vera", "scan",
  "insights", "activity", "alerts", "holding", "send", "receive", "settings",
]);

export interface AppUrlState {
  /** "chat" | "groves" | a canvas name | null (menu). */
  tab: string | null;
  /** Grove id when tab === "groves". */
  id?: string | null;
  /** Holding symbol when tab === "holding". */
  sym?: string | null;
}

export function isCanvasTab(tab: string): boolean {
  return CANVASES.has(tab);
}

export function readAppUrl(): AppUrlState {
  const q = new URLSearchParams(window.location.search);
  const tab = q.get("tab");
  if (!tab) return { tab: null };
  if (tab === "chat") return { tab };
  if (tab === "groves") return { tab, id: q.get("id") };
  if (CANVASES.has(tab)) return { tab, sym: q.get("sym") };
  return { tab: null };
}

/** Reflect the current view into the URL without touching unrelated params. */
export function writeAppUrl(state: AppUrlState, opts?: { replace?: boolean }): void {
  const q = new URLSearchParams(window.location.search);
  q.delete("tab");
  q.delete("id");
  q.delete("sym");
  if (state.tab) {
    q.set("tab", state.tab);
    if (state.tab === "groves" && state.id) q.set("id", state.id);
    if (state.tab === "holding" && state.sym) q.set("sym", state.sym);
  }
  const rest = q.toString();
  const next = `${window.location.pathname}${rest ? `?${rest}` : ""}`;
  if (next !== window.location.pathname + window.location.search) {
    if (opts?.replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  }
}
