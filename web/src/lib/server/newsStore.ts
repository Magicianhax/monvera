import "server-only";

// D1 helpers for news_sends (migration 0013) — the anti-spam ledger behind the
// per-(user,symbol) cooldown and the per-user daily cap. Same store pattern as
// notifyStore: bindings, no credentials.
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

/** Thrown by the two read paths. An EMPTY result from either would read as
 *  "nobody has been sent anything", which fails OPEN into exactly the storm the
 *  caps exist to prevent — so they throw and the sweep aborts its send phase. */
export class NewsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsStoreError";
  }
}

/** Called ONLY after addNotification returned true. */
export async function recordSend(userId: string, symbol: string, guid: string, at: number): Promise<void> {
  await db()
    .prepare("INSERT INTO news_sends (user_id, symbol, guid, sent_at) VALUES (?, ?, ?, ?)")
    .bind(userId, symbol, guid, at)
    .run();
}

/** How many news alerts each of `userIds` has had since `since` (ms) — one
 *  query for the whole recipient set, not one per user. Fail-closed: throws. */
export async function sentSince(userIds: string[], since: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  try {
    for (let i = 0; i < userIds.length; i += 100) {
      const chunk = userIds.slice(i, i + 100);
      const holes = chunk.map(() => "?").join(",");
      const { results } = await db()
        .prepare(`SELECT user_id, COUNT(*) c FROM news_sends WHERE sent_at >= ? AND user_id IN (${holes}) GROUP BY user_id`)
        .bind(since, ...chunk)
        .all<{ user_id: string; c: number }>();
      for (const r of results ?? []) out.set(r.user_id, Number(r.c) || 0);
    }
    return out;
  } catch (err) {
    throw new NewsStoreError(`sentSince failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Users already told about `symbol` since `since` (ms). Fail-closed: throws. */
export async function symbolSentSince(symbol: string, since: number): Promise<Set<string>> {
  try {
    const { results } = await db()
      .prepare("SELECT DISTINCT user_id FROM news_sends WHERE symbol = ? AND sent_at >= ?")
      .bind(symbol, since)
      .all<{ user_id: string }>();
    return new Set((results ?? []).map((r) => r.user_id));
  } catch (err) {
    throw new NewsStoreError(`symbolSentSince failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Best-effort housekeeping at the end of a sweep. */
export async function pruneNewsSends(days = 14): Promise<void> {
  try {
    await db()
      .prepare("DELETE FROM news_sends WHERE sent_at < ?")
      .bind(Date.now() - days * 86_400_000)
      .run();
  } catch {
    /* the ledger growing a little is never worth failing a sweep */
  }
}
