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
// 2. Geo-gate — Monvera is not offered in the US, Canada, the UK, or
//    Switzerland (Robinhood Chain stock-token restrictions + our
//    launch-compliance decision). Country comes from Cloudflare's
//    CF-IPCountry header; absent header (local dev) allows — the gate is a
//    compliance screen, not a security boundary.
const BLOCKED = new Set(["US", "CA", "GB", "CH"]);

// The https redirect must see EVERY request, so the matcher is broad; the
// geo-gate applies only to the product + money-moving APIs below. Static
// assets (_next, files with extensions) are excluded to keep them on the
// fast path — they are only ever referenced from pages that already
// redirected to https.
export const config = {
  matcher: ["/((?!_next/|.*\\..*).*)"],
};

const GATED_PAGES = ["/app"];
const GATED_APIS = ["/api/quote", "/api/allocate", "/api/portfolio-review", "/api/autopilot", "/api/pimlico"];

// Social / link-preview crawlers only read a page's OG metadata to build a card;
// they don't "use" the product. They run from US datacenters, so the geo-gate's
// 451 /restricted rewrite left every shared /app link with no preview card on X,
// Slack, Discord, etc. Let them through to the real page (200 + OG). Real users
// are still gated by country below.
const CRAWLER_UA =
  /facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|discordbot|linkedinbot|telegrambot|whatsapp|pinterest|redditbot|applebot|googlebot|bingbot|skypeuripreview|embedly|iframely|vkshare|google-inspectiontool|mastodon|opengraph|w3c_validator/i;

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

  // ── 2. geo-gate (product + money APIs only) ──
  const path = req.nextUrl.pathname;
  const gatedPage = GATED_PAGES.some((p) => path === p || path.startsWith(p + "/"));
  const gatedApi = GATED_APIS.some((p) => path === p || path.startsWith(p + "/"));
  if (!gatedPage && !gatedApi) return NextResponse.next();

  // Link-preview crawlers may bypass the gate ONLY for pages, so a shared /app
  // link renders its OG card. User-Agent is spoofable, which is acceptable here:
  // the geo-gate is a compliance screen (already VPN-bypassable) and a page view
  // moves no money. The money-moving APIs are NEVER header-bypassable — a spoofed
  // UA must not reach a gated endpoint.
  if (gatedPage && !gatedApi && CRAWLER_UA.test(req.headers.get("user-agent") ?? "")) {
    return NextResponse.next();
  }

  const country = req.headers.get("cf-ipcountry")?.toUpperCase();
  if (!country || !BLOCKED.has(country)) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Monvera is not available in your region." },
      { status: 451 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/restricted";
  return NextResponse.rewrite(url, { status: 451 });
}
