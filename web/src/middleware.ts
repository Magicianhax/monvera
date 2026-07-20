import { NextResponse, type NextRequest } from "next/server";

// Two jobs, in order:
//
// 1. HTTPS enforcement — the zone was serving full plaintext pages on :80
//    (no "Always Use HTTPS" at the edge). X auto-links scheme-less tweet text
//    as http://, and Apple's network stack handles that upgrade differently
//    from Android, which broke every tweet link in the iOS X app and bare
//    typing in iOS Safari. A permanent 301 here closes the http path no
//    matter what the edge setting says.
//
// 2. Host canonicalization — the app lives at app.monvera.best (flag-gated).
//
// The geo-gate (US/CA/GB/CH → 451) was REMOVED 2026-07-20 by owner decision:
// it tracked the Arcus venue's restrictions, and Arcus is out of the venue
// set. Monvera is open worldwide. The gate lives in git history if a future
// venue needs it back.

// The https redirect must see EVERY request, so the matcher is broad. Static
// assets (_next, files with extensions) are excluded to keep them on the
// fast path — they are only ever referenced from pages that already
// redirected to https.
export const config = {
  matcher: ["/((?!_next/|.*\\..*).*)"],
};

// Flip to true ONLY after app.monvera.best is in Privy's allowed origins —
// redirecting the apex /app there before that breaks every login. Until then
// the subdomain quietly serves the app (rewrite below) for testing, and the
// canonical URL stays monvera.best/app.
const APEX_APP_REDIRECT = false;

function isHttp(req: NextRequest): boolean {
  // Cloudflare terminates TLS; the original scheme arrives in headers. Check
  // both spellings — cf-visitor is CF-specific, x-forwarded-proto is generic.
  const xfp = req.headers.get("x-forwarded-proto");
  if (xfp) return xfp.split(",")[0].trim() === "http";
  const visitor = req.headers.get("cf-visitor");
  if (visitor) {
    try {
      return JSON.parse(visitor).scheme === "http";
    } catch {
      /* fall through */
    }
  }
  return false;
}

// Local dev runs plain http on localhost; Next's dev server injects
// x-forwarded-proto: http, which would 301 every request to https://localhost
// (no TLS server there) and make `npm run dev` unreachable. The edge upgrade is
// only meaningful for the real domain, so skip it for loopback hosts.
function isLocalhost(req: NextRequest): boolean {
  const h = req.nextUrl.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]";
}

export function middleware(req: NextRequest) {
  // ── 1. http -> https, permanent (skipped on loopback for local dev) ──
  if (isHttp(req) && !isLocalhost(req)) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  // ── 1b. the app lives at app.monvera.best ──
  // On the subdomain, "/" (and /app itself) serve the app page — query params
  // (?tab=…) carry over so every in-app link works there. On the apex, /app*
  // permanently redirects to the subdomain (once the flag is on).
  const host = req.nextUrl.hostname;
  if (host === "app.monvera.best") {
    if (req.nextUrl.pathname === "/" || req.nextUrl.pathname === "/app") {
      const url = req.nextUrl.clone();
      url.pathname = "/app";
      return NextResponse.rewrite(url);
    }
  } else if (APEX_APP_REDIRECT && (host === "monvera.best" || host === "www.monvera.best")) {
    if (req.nextUrl.pathname === "/app" || req.nextUrl.pathname.startsWith("/app/")) {
      const url = req.nextUrl.clone();
      url.hostname = "app.monvera.best";
      url.pathname = "/";
      return NextResponse.redirect(url, 301);
    }
  }

  return NextResponse.next();
}
