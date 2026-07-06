"use client";

// Attaches the caller's Privy access token to same-origin API requests so the
// server can verify the session (see lib/server/privyAuth.ts). `getAccessToken`
// is a standalone Privy helper — it returns the current token, refreshing if
// needed, or null when signed out.
import { getAccessToken } from "@privy-io/react-auth";

/** `{ Authorization: "Bearer <token>" }` when signed in, else `{}`. */
export async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
