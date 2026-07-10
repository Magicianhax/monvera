import { NextResponse, type NextRequest } from "next/server";

// Geo-gate — Monvera is not offered in the US, Canada, the UK, or Switzerland
// (Robinhood Chain stock-token restrictions + our launch-compliance decision).
//
// Country comes from Cloudflare's CF-IPCountry header (present on every
// CF-proxied request; the whole stack deploys on Cloudflare). When the header
// is absent (local dev, direct hits) we allow — the gate is a compliance
// screen, not a security boundary.
const BLOCKED = new Set(["US", "CA", "GB", "CH"]);

// Only the product + money-moving APIs are gated; the marketing site, demo,
// prices, and icons stay world-readable.
export const config = {
  matcher: [
    "/app/:path*",
    "/app",
    "/api/quote/:path*",
    "/api/allocate/:path*",
    "/api/portfolio-review/:path*",
    "/api/autopilot/:path*",
    "/api/pimlico/:path*",
  ],
};

export function middleware(req: NextRequest) {
  const country = req.headers.get("cf-ipcountry")?.toUpperCase();
  if (!country || !BLOCKED.has(country)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Monvera is not available in your region." },
      { status: 451 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/restricted";
  return NextResponse.rewrite(url, { status: 451 });
}
