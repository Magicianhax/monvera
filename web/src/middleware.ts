import { NextResponse, type NextRequest } from "next/server";
import { APP_VIEW_SEGMENTS } from "@/components/chat/appUrl";

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

// ON since 2026-07-20: app.monvera.best is in Privy's allowed origins, so the
// apex /app permanently redirects to the subdomain — the app's canonical home.
const APEX_APP_REDIRECT = true;

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
  // Every in-app view is a real path (appUrl.ts): /groves/titan, /portfolio,
  // /staking, … all serve the /app shell via rewrite, so a shared link or a
  // refresh lands on the page it names. Legacy links keep working end to end:
  // ?tab=… carries through and the shell upgrades it to the path form, and
  // /app/<view> on any host is canonicalized. On the apex, /app* permanently
  // redirects to the subdomain (once the flag is on), subpath preserved.
  const host = req.nextUrl.hostname;
  const pathname = req.nextUrl.pathname;
  const firstSegment = pathname.split("/")[1] ?? "";
  if (host === "app.monvera.best") {
    // Canonical home is the bare path — old /app links 301 to it.
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const url = req.nextUrl.clone();
      url.pathname = pathname.slice("/app".length) || "/";
      return NextResponse.redirect(url, 301);
    }
    if (pathname === "/" || APP_VIEW_SEGMENTS.has(firstSegment)) {
      const url = req.nextUrl.clone();
      url.pathname = "/app";
      return NextResponse.rewrite(url);
    }
  } else if (APEX_APP_REDIRECT && (host === "monvera.best" || host === "www.monvera.best")) {
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const url = req.nextUrl.clone();
      url.hostname = "app.monvera.best";
      url.pathname = pathname.slice("/app".length) || "/";
      return NextResponse.redirect(url, 301);
    }
  } else if (pathname.startsWith("/app/")) {
    // Local dev (and any other host serving the shell at /app): the path form
    // hangs off /app — /app/groves/titan serves the same shell page.
    const url = req.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}
