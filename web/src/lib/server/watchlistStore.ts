import "server-only";

// Watchlist — Cloudflare D1 (schema: migrations/0003). Same binding-only store
// pattern as notifyStore / autopilotStore (no credentials). The client keeps a
// localStorage cache for instant UX; this is the cross-device source of truth.
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
}
interface D1Db { prepare(sql: string): D1Stmt }

function db(): D1Db {
  const env = getCloudflareContext().env as { DB?: D1Db };
  if (!env.DB) throw new Error("D1 binding DB is not configured.");
  return env.DB;
}

// A generous ceiling so a runaway client can't bloat a row set. Stars are cheap.
const MAX_WATCHED = 300;

/** The user's watched symbols, oldest first (insertion order). */
export async function listWatchlist(userId: string): Promise<string[]> {
  const rows = await db()
    .prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at ASC")
    .bind(userId)
    .all<{ symbol: string }>();
  return rows.results.map((r) => r.symbol);
}

/** Add a symbol (idempotent). Silently no-ops past the per-user ceiling. */
export async function addWatch(userId: string, symbol: string, now: number): Promise<void> {
  const count = await db()
    .prepare("SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_WATCHED) return;
  await db()
    .prepare("INSERT OR IGNORE INTO watchlist (user_id, symbol, created_at) VALUES (?, ?, ?)")
    .bind(userId, symbol, now)
    .run();
}

/** Remove a symbol (idempotent). */
export async function removeWatch(userId: string, symbol: string): Promise<void> {
  await db()
    .prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?")
    .bind(userId, symbol)
    .run();
}
