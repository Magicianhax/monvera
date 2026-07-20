// Monvera service worker — hand-authored (no serwist/workbox).
// public/ is served verbatim at /sw.js by Turbopack (no bundler processing).
//
// CACHE_VERSION must change on every deploy that touches the app shell, or a
// returning user keeps a stale precache whose hashed chunks were deleted from
// the origin. The deploy script stamps the build id over the __BUILD_ID__
// token below, so this is automatic; the literal fallback only ships in local
// dev, which is fine.
//
// RESILIENCE RULE: the Cache API is treated as OPTIONAL. Some embedded
// webviews (X for iPhone 12.7 being the live example) expose service workers
// but ship a broken or blocked `caches` — and any unhandled rejection inside
// respondWith() makes the BROWSER report the navigation itself as failed
// ("This page couldn't load"). So every cache touch below is wrapped: when
// caching is unavailable the worker degrades to a plain network passthrough,
// never to a dead page. Same for install/activate, so a fixed worker can
// still take over inside a broken environment.
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

// ── guarded cache helpers: never throw, return null when caching is broken ──
async function cacheOpen(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}
async function cacheMatch(cacheOrName, request) {
  try {
    const cache = typeof cacheOrName === "string" ? await caches.open(cacheOrName) : cacheOrName;
    return cache ? await cache.match(request) : null;
  } catch {
    return null;
  }
}

function offlineResponse() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monvera</title></head>' +
      '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#eef1e8;color:#232a24;font:16px system-ui,sans-serif;text-align:center">' +
      '<div><p style="font-size:34px;margin:0 0 8px">&#127807;</p><h1 style="font-size:20px;margin:0 0 6px">You look offline</h1>' +
      '<p style="margin:0 0 16px;color:#545d52">Monvera is fine, the connection dropped. Try again in a moment.</p>' +
      '<button onclick="location.reload()" style="font:600 15px system-ui;padding:10px 22px;border-radius:999px;border:0;background:#57a07e;color:#fff">Retry</button></div></body></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await cacheOpen(PRECACHE);
        if (cache) {
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
        }
      } catch {
        /* a broken Cache API must never block installation */
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
      } catch {
        /* cleanup is best-effort */
      }
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
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // MONEY-APP SAFETY: only ever handle same-origin GETs. Never touch cross-origin
  // (Privy / wagmi / Pimlico / Anthropic / RPC) or any non-GET — we must not serve
  // a stale balance or replay a signed transaction.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API / auth routes — always go to network.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations (HTML): network-first, fall back to cache, then a synthesized
  // offline page. This promise can NEVER reject — a rejected respondWith turns
  // into the browser's native "page couldn't load", which reads as an outage.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          // One short retry before declaring the world offline — mobile radios
          // waking from sleep fail the FIRST request constantly, and falling
          // straight to the offline page reads as "the app is down".
          try {
            await new Promise((r) => setTimeout(r, 450));
            return await fetch(request);
          } catch {
            const cached =
              (await cacheMatch(PRECACHE, request)) || (await cacheMatch(PRECACHE, OFFLINE_URL));
            return cached || offlineResponse();
          }
        }
      })().catch(() => offlineResponse()),
    );
    return;
  }

  // Static assets: cache-first (content-hashed under _next/static). When the
  // Cache API is unavailable this degrades to a plain network passthrough.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await cacheMatch(RUNTIME, request);
        if (cached) return cached;
        const precached = await cacheMatch(PRECACHE, request);
        if (precached) return precached;
        const res = await fetch(request);
        try {
          if (res.ok) {
            const cache = await cacheOpen(RUNTIME);
            if (cache) await cache.put(request, res.clone());
          }
        } catch {
          /* caching is best-effort */
        }
        return res;
      })().catch(() => fetch(request)),
    );
  }
  // Everything else passes through to the network (default).
});
