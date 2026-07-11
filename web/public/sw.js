// Monvera service worker — hand-authored (no serwist/workbox).
// public/ is served verbatim at /sw.js by Turbopack (no bundler processing).
//
// CACHE_VERSION must change on every deploy that touches the app shell, or a
// returning user keeps a stale precache whose hashed chunks were deleted from
// the origin — and any network blip then falls through to a hard "page couldn't
// load". It was manually pinned at v1 across many deploys (the bug). The deploy
// script now stamps the build id over the __BUILD_ID__ token below, so this is
// automatic; the literal fallback only ships in local dev, which is fine.
const CACHE_VERSION = "monvera-__BUILD_ID__";
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = "/offline";

// App-shell assets to precache on install. Keep this small + stable.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // Individual puts so a single 404 (e.g. a renamed icon) can't brick install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res.ok) await cache.put(url, res);
          } catch {
            /* ignore individual precache misses */
          }
        }),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf|css|js)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // MONEY-APP SAFETY: only ever handle same-origin GETs. Never touch cross-origin
  // (Privy / wagmi / Pimlico / Anthropic / RPC) or any non-GET — we must not serve
  // a stale balance or replay a signed transaction.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API / auth routes — always go to network.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations (HTML): network-first, fall back to cache, then /offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(PRECACHE);
          return (await cache.match(request)) || (await cache.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first (content-hashed under _next/static).
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(RUNTIME);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          return cached || Response.error();
        }
      })(),
    );
  }
  // Everything else passes through to the network (default).
});
