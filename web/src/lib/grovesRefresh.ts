"use client";

// Tell the server a grove buy or exit just settled, so the public book stops
// showing the pre-trade numbers.
//
// These transactions are sponsored UserOps sent from the browser: the server is
// never in the path and has no way to learn a position opened or closed. Without
// this, the stats aged out of a 60s build behind a 60s/300s edge cache, so
// "Investors 2 · Total invested $595" survived a holder fully exiting by several
// minutes — visibly wrong on the page that is meant to be the honest one.
//
// Best-effort by construction. The caller has already succeeded on-chain; a
// failed cache hint must never surface as an error or block the success UI, and
// the old TTL still expires on its own.
import { authHeader } from "@/lib/authedFetch";

export async function notifyGrovesChanged(): Promise<void> {
  try {
    await fetch("/api/groves/refresh", {
      method: "POST",
      headers: { ...(await authHeader()) },
      keepalive: true, // survives the user navigating away from the success screen
    });
  } catch {
    /* the numbers self-heal on the next TTL; never let this break a settled trade */
  }
}
