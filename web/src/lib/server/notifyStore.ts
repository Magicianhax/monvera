import "server-only";

// Notification Center + price alerts — Cloudflare D1 (schema: migrations/0002).
// Same store pattern as autopilotStore: bindings, no credentials.
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

export type NotificationKind = "alert" | "autopilot" | "trade" | "system";
export interface Notification {
  id: number;
  kind: NotificationKind;
  title: string;
  body?: string;
  symbol?: string;
  txHash?: string;
  createdAt: number;
  readAt?: number;
}
export interface PriceAlert {
  id: number;
  symbol: string;
  direction: "above" | "below";
  threshold: number;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
}

interface NRow { id: number; kind: NotificationKind; title: string; body: string | null; symbol: string | null; tx_hash: string | null; created_at: number; read_at: number | null }
interface ARow { id: number; user_id: string; symbol: string; direction: "above" | "below"; threshold: number; active: number; created_at: number; triggered_at: number | null }

/** Append a notification. Failures never break the caller. */
export async function addNotification(
  userId: string,
  n: { kind: NotificationKind; title: string; body?: string; symbol?: string; txHash?: string; at: number },
): Promise<void> {
  try {
    await db()
      .prepare("INSERT INTO notifications (user_id, kind, title, body, symbol, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(userId, n.kind, n.title, n.body ?? null, n.symbol ?? null, n.txHash ?? null, n.at)
      .run();
  } catch (e) {
    console.error("[notify] add failed:", e instanceof Error ? e.message : e);
  }
}

export async function listNotifications(userId: string, limit = 50): Promise<Notification[]> {
  const { results } = await db()
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, limit)
    .all<NRow>();
  return (results ?? []).map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body ?? undefined, symbol: r.symbol ?? undefined,
    txHash: r.tx_hash ?? undefined, createdAt: r.created_at, readAt: r.read_at ?? undefined,
  }));
}

export async function unreadCount(userId: string): Promise<number> {
  const row = await db()
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL")
    .bind(userId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function markAllRead(userId: string, at: number): Promise<void> {
  await db().prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(at, userId).run();
}

export async function createAlert(userId: string, a: { symbol: string; direction: "above" | "below"; threshold: number; at: number }): Promise<void> {
  await db()
    .prepare("INSERT INTO alerts (user_id, symbol, direction, threshold, active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .bind(userId, a.symbol, a.direction, a.threshold, a.at)
    .run();
}

export async function listAlerts(userId: string): Promise<PriceAlert[]> {
  const { results } = await db()
    .prepare("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
    .bind(userId)
    .all<ARow>();
  return (results ?? []).map((r) => ({
    id: r.id, symbol: r.symbol, direction: r.direction, threshold: r.threshold,
    active: Boolean(r.active), createdAt: r.created_at, triggeredAt: r.triggered_at ?? undefined,
  }));
}

export async function deleteAlert(userId: string, id: number): Promise<void> {
  await db().prepare("DELETE FROM alerts WHERE user_id = ? AND id = ?").bind(userId, id).run();
}

/** All active alerts across users (cron sweep). */
export async function activeAlerts(): Promise<(PriceAlert & { userId: string })[]> {
  const { results } = await db().prepare("SELECT * FROM alerts WHERE active = 1 LIMIT 500").all<ARow>();
  return (results ?? []).map((r) => ({
    id: r.id, userId: r.user_id, symbol: r.symbol, direction: r.direction, threshold: r.threshold,
    active: true, createdAt: r.created_at, triggeredAt: r.triggered_at ?? undefined,
  }));
}

/** Deactivate a fired alert (idempotent: only flips if still active). Returns true if this call claimed it. */
export async function claimTriggered(id: number, at: number): Promise<boolean> {
  const { results } = await db()
    .prepare("UPDATE alerts SET active = 0, triggered_at = ? WHERE id = ? AND active = 1 RETURNING id")
    .bind(at, id)
    .run<{ id: number }>();
  return (results ?? []).length > 0;
}
