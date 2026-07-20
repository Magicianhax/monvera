import "server-only";

// Balance snapshots (D1): one row per known address per hour — the data
// behind the real equity curve. Written by /api/cron/balances, read by
// /api/balance-history. Same defensive D1 access style as userDirectory.
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

export interface BalanceSnapshot {
  takenAt: number;
  cashUsd: number;
  investedUsd: number;
  totalUsd: number;
}

/** Upsert one hourly snapshot (idempotent per address+hour — cron retries are safe). */
export async function putSnapshot(address: string, takenAt: number, cashUsd: number, investedUsd: number, totalUsd: number): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO balance_snapshots (address, taken_at, cash_usd, invested_usd, total_usd) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(address, taken_at) DO UPDATE SET cash_usd = excluded.cash_usd, invested_usd = excluded.invested_usd, total_usd = excluded.total_usd",
    )
    .bind(address.toLowerCase(), takenAt, cashUsd, investedUsd, totalUsd)
    .run();
}

/** Snapshots for one address, oldest -> newest, within the last `hours`. */
export async function listSnapshots(address: string, hours = 24 * 30): Promise<BalanceSnapshot[]> {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const { results } = await db()
    .prepare("SELECT taken_at, cash_usd, invested_usd, total_usd FROM balance_snapshots WHERE address = ? AND taken_at >= ? ORDER BY taken_at ASC")
    .bind(address.toLowerCase(), since)
    .all<{ taken_at: number; cash_usd: number; invested_usd: number; total_usd: number }>();
  return (results ?? []).map((r) => ({ takenAt: r.taken_at, cashUsd: r.cash_usd, investedUsd: r.invested_usd, totalUsd: r.total_usd }));
}

/** Drop rows older than `days` — the curve is a product feature, not an archive. */
export async function pruneSnapshots(days = 90): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  await db().prepare("DELETE FROM balance_snapshots WHERE taken_at < ?").bind(cutoff).run();
}
