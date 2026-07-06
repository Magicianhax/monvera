"use client";

// Cross-device watchlist sync. Mounted once (LiteApp). On sign-in it reconciles
// the device-local watchlist with the server's (union, so pre-login stars are
// kept and pushed up), then registers a write-through pusher so every later
// toggle mirrors to D1. Signed out, the watchlist stays purely device-local.
import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { authHeader } from "@/lib/authedFetch";
import { registerRemotePush, snapshotWatchlist, hydrateWatchlist } from "@/lib/watchlist";

async function push(symbol: string, on: boolean) {
  const h = await authHeader();
  if (!h.Authorization) return;
  try {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({ symbol, on }),
    });
  } catch {
    /* offline / transient — the local cache still holds the change */
  }
}

export function useWatchlistSync() {
  const { ready, authenticated } = usePrivy();

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;

    (async () => {
      const h = await authHeader();
      if (!h.Authorization || cancelled) return;
      try {
        const r = await fetch("/api/watchlist", { headers: h });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { symbols?: unknown };
        const server = Array.isArray(j.symbols)
          ? j.symbols.filter((s): s is string => typeof s === "string")
          : [];
        const local = snapshotWatchlist();
        const localOnly = local.filter((s) => !server.includes(s));
        // Push pre-login local-only stars up so nothing is lost on first sync.
        for (const s of localOnly) void push(s, true);
        if (!cancelled) hydrateWatchlist([...server, ...localOnly]);
      } catch {
        /* keep the local cache as-is on any failure */
      }
    })();

    registerRemotePush(push);
    return () => {
      cancelled = true;
      registerRemotePush(null);
    };
  }, [ready, authenticated]);
}
