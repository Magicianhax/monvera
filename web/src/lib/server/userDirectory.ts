import "server-only";

// User directory (D1): userId -> wallet + last-seen, written fire-and-forget
// on each authed Vera turn. The weekly brief uses it to reach every signed-in
// user, not only autopilot holders. Failures never break the caller — the
// directory is best-effort by design (migration 0009).
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run<T = unknown>(): Promise<{ results: T[] }>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
interface D1Db {
  prepare(sql: string): D1Stmt;
}

function db(): D1Db {
  const env = getCloudflareContext().env as { DB?: D1Db };
  if (!env.DB) throw new Error("D1 binding DB is not configured.");
  return env.DB;
}

/**
 * Record who this user is. `smartAddress` is the ERC-4337 smart account
 * (migration 0011) — COALESCE keeps a previously recorded value when a caller
 * doesn't have it in hand, so an old client or a smart-less touch can never
 * erase what a newer one reported.
 */
export async function touchUser(userId: string, address: string, smartAddress?: string): Promise<void> {
  try {
    await db()
      .prepare(
        "INSERT INTO user_directory (user_id, address, smart_address, last_seen) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(user_id) DO UPDATE SET address = excluded.address, " +
          "smart_address = COALESCE(excluded.smart_address, user_directory.smart_address), " +
          "last_seen = excluded.last_seen",
      )
      .bind(userId, address.toLowerCase(), smartAddress?.toLowerCase() ?? null, Math.floor(Date.now() / 1000))
      .run();
  } catch {
    /* directory is best-effort; a missing table must never break a chat turn */
  }
}

/** Users seen in the last `days` — the weekly brief's audience. `smartAddress`
 *  is null until the client has reported it (see touchUser). */
export async function listRecentUsers(
  days = 30,
  limit = 2000,
): Promise<{ userId: string; address: string; smartAddress: string | null }[]> {
  try {
    const since = Math.floor(Date.now() / 1000) - days * 86_400;
    const { results } = await db()
      .prepare("SELECT user_id, address, smart_address FROM user_directory WHERE last_seen >= ? LIMIT ?")
      .bind(since, limit)
      .all<{ user_id: string; address: string; smart_address: string | null }>();
    return (results ?? []).map((r) => ({ userId: r.user_id, address: r.address, smartAddress: r.smart_address ?? null }));
  } catch {
    return [];
  }
}
