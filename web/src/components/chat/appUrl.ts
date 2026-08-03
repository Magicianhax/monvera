// Two-way sync between the app's view state and the URL, so a refresh (or a
// shared link) lands on the same page instead of resetting to the menu.
//
// The URL is a real PATH — every page is shareable:
//
//   /                → home menu
//   /chat            → the conversation
//   /groves          → Groves shelf
//   /groves/<id>     → a Grove detail page
//   /staking         → staking
//   /holding/<SYM>   → one holding's canvas
//   /<canvas>        → a canvas (portfolio, market, wallet, token, …)
//
// On app.monvera.best those paths hang off the root; in local dev (and on any
// host still serving the shell at /app) the same paths hang off /app —
// basePath() picks per load. The middleware rewrites every view path to the
// /app shell route, so a refresh serves the app; pushState/replaceState here
// integrate with the Next router (shallow — no reload, no RSC fetch).
//
// The OLD encodings keep parsing forever, so every link ever shared still
// lands right and upgrades itself: ?tab=<view>[&id=…][&sym=…] is read when
// the path carries no view, and the shells' initial replace-normalization
// rewrites it to the path form. (?grove=<id>&auto=1 is handled in the shells
// before this runs, as before.)
//
// Every view change pushes a history entry, so the browser's back button walks
// back through the app (canvas → chat → menu) instead of leaving it — the
// shells listen for popstate and re-apply the URL. Writes that merely
// normalize the current view (initial load) replace instead.

const CANVASES = new Set([
  "portfolio", "market", "wallet", "token", "autopilot", "vera", "scan",
  "insights", "activity", "alerts", "holding", "send", "receive", "settings",
]);

/** First path segments that belong to the app shell — the middleware rewrites
 *  these to /app on the app subdomain (and under /app/ everywhere). Pure data:
 *  this module is imported by the edge middleware, so nothing here may touch
 *  `window` at module scope. */
export const APP_VIEW_SEGMENTS: ReadonlySet<string> = new Set(["chat", "staking", "groves", ...CANVASES]);

export interface AppUrlState {
  /** "chat" | "groves" | "staking" | a canvas name | null (menu). */
  tab: string | null;
  /** Grove id when tab === "groves". */
  id?: string | null;
  /** Holding symbol when tab === "holding". */
  sym?: string | null;
}

export function isCanvasTab(tab: string): boolean {
  return CANVASES.has(tab);
}

/** "/app" when the shell is served from /app (dev, apex fallback), else "". */
function basePath(): string {
  const p = window.location.pathname;
  return p === "/app" || p.startsWith("/app/") ? "/app" : "";
}

function readPath(): AppUrlState {
  const path = window.location.pathname.replace(/^\/app(?=\/|$)/, "");
  const segs = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!segs.length) return { tab: null };
  const [head, second] = segs;
  if (head === "chat" || head === "staking") return { tab: head };
  if (head === "groves") return { tab: "groves", id: second ?? null };
  if (head === "holding") return { tab: "holding", sym: second ?? null };
  if (CANVASES.has(head)) return { tab: head, sym: null };
  return { tab: null };
}

function readLegacyQuery(): AppUrlState | null {
  const q = new URLSearchParams(window.location.search);
  const tab = q.get("tab");
  if (!tab) return null;
  if (tab === "chat" || tab === "staking") return { tab };
  if (tab === "groves") return { tab, id: q.get("id") };
  if (CANVASES.has(tab)) return { tab, sym: q.get("sym") };
  return { tab: null };
}

export function readAppUrl(): AppUrlState {
  const fromPath = readPath();
  if (fromPath.tab) return fromPath;
  // Path says menu — an old ?tab= link (or bookmark) still decides the view.
  return readLegacyQuery() ?? fromPath;
}

/** Reflect the current view into the URL without touching unrelated params
 *  (?view=mobile survives; the legacy tab/id/sym params are consumed). */
export function writeAppUrl(state: AppUrlState, opts?: { replace?: boolean }): void {
  const q = new URLSearchParams(window.location.search);
  q.delete("tab");
  q.delete("id");
  q.delete("sym");

  let path = "/";
  if (state.tab === "groves") path = state.id ? `/groves/${encodeURIComponent(state.id)}` : "/groves";
  else if (state.tab === "holding" && state.sym) path = `/holding/${encodeURIComponent(state.sym)}`;
  else if (state.tab) path = `/${state.tab}`;

  const base = basePath();
  const pathname = path === "/" ? base || "/" : `${base}${path}`;
  const rest = q.toString();
  const next = `${pathname}${rest ? `?${rest}` : ""}`;
  if (next !== window.location.pathname + window.location.search) {
    if (opts?.replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  }
}
