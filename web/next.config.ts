import type { NextConfig } from "next";

// Baseline HTTP security headers. The CSP is intentionally limited to
// `frame-ancestors 'none'` (anti-clickjacking — critical for a money app) so it
// does NOT constrain script/style/connect sources; a full source-locked CSP is a
// larger effort because Privy/wagmi/Pimlico/Anthropic each need allow-listed
// origins and the UI uses many inline styles. Everything else below is safe to
// apply globally today.
const securityHeaders = [
  // `same-origin-allow-popups` (not `same-origin`): Privy's Google/X login opens
  // OAuth popups that must keep a handle to the opener. This also satisfies the
  // COOP self-check inside Privy's bundled Coinbase wallet SDK, which otherwise
  // logs "Error checking Cross-Origin-Opener-Policy" in the console.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // Pin the project root to THIS app. The workspace has a stray root
  // package-lock.json, so Next inferred F:\Tools\mantle as the root and
  // Turbopack watched the entire tree — video renders, brand assets, and
  // several unrelated node_modules — which is filesystem-watcher and memory
  // poison in dev. Every command already runs from stax/web, so cwd is it.
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Never cache the worker file itself, so a CACHE_VERSION bump deploys instantly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
