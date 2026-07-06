import "server-only";

// Autopilot store — Cloudflare D1 (durable source of truth).
//   autopilots      one row per user: the config + run accounting.
//   autopilot_runs  append-only audit log of every run (success/skipped/error).
//
// Scheduling safety: the cron claims due rows with a single
// UPDATE ... RETURNING that advances next_run_at (and resets the period spend)
// as it reads, so two overlapping cron invocations can never run the same
// autopilot twice. recordRun() therefore never touches next_run_at; the claim
// owns the schedule. Schema: web/migrations/0001_autopilot.sql.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AutopilotConfig } from "@/lib/autopilot";

// Minimal structural D1 types (no dependency on generated cloudflare-env.d.ts).
interface D1Result<T> {
  results: T[];
}
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
}
interface D1Db {
  prepare(sql: string): D1Stmt;
}

function db(): D1Db {
  const env = getCloudflareContext().env as { DB?: D1Db };
  if (!env.DB) throw new Error("D1 binding DB is not configured (wrangler.jsonc d1_databases).");
  return env.DB;
}

interface Row {
  user_id: string;
  id: string;
  wallet_id: string;
  owner: string;
  smart_account: string;
  goal: string;
  amount_usd: number;
  cadence: AutopilotConfig["cadence"];
  risk_ceiling_bps: number;
  max_per_period_usd: number;
  active: number;
  created_at: number;
  next_run_at: number;
  last_run_at: number | null;
  runs: number;
  spent_this_period: number;
}

function rowToConfig(r: Row): AutopilotConfig {
  return {
    id: r.id,
    userId: r.user_id,
    walletId: r.wallet_id,
    owner: r.owner as `0x${string}`,
    smartAccount: r.smart_account as `0x${string}`,
    goal: r.goal,
    amountUsd: r.amount_usd,
    cadence: r.cadence,
    riskCeilingBps: r.risk_ceiling_bps,
    maxPerPeriodUsd: r.max_per_period_usd,
    active: Boolean(r.active),
    createdAt: r.created_at,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at ?? undefined,
    runs: r.runs,
    spentThisPeriod: r.spent_this_period,
  };
}

export async function getAutopilot(userId: string): Promise<AutopilotConfig | null> {
  const row = await db().prepare("SELECT * FROM autopilots WHERE user_id = ?").bind(userId).first<Row>();
  return row ? rowToConfig(row) : null;
}

export async function upsertAutopilot(cfg: AutopilotConfig): Promise<AutopilotConfig> {
  await db()
    .prepare(
      `INSERT INTO autopilots (user_id, id, wallet_id, owner, smart_account, goal, amount_usd,
         cadence, risk_ceiling_bps, max_per_period_usd, active, created_at, next_run_at,
         last_run_at, runs, spent_this_period)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         id = excluded.id, wallet_id = excluded.wallet_id, owner = excluded.owner,
         smart_account = excluded.smart_account, goal = excluded.goal,
         amount_usd = excluded.amount_usd, cadence = excluded.cadence,
         risk_ceiling_bps = excluded.risk_ceiling_bps,
         max_per_period_usd = excluded.max_per_period_usd, active = excluded.active,
         created_at = excluded.created_at, next_run_at = excluded.next_run_at,
         last_run_at = excluded.last_run_at, runs = excluded.runs,
         spent_this_period = excluded.spent_this_period`,
    )
    .bind(
      cfg.userId, cfg.id, cfg.walletId, cfg.owner, cfg.smartAccount, cfg.goal, cfg.amountUsd,
      cfg.cadence, cfg.riskCeilingBps, cfg.maxPerPeriodUsd, cfg.active ? 1 : 0, cfg.createdAt,
      cfg.nextRunAt, cfg.lastRunAt ?? null, cfg.runs, cfg.spentThisPeriod,
    )
    .run();
  return cfg;
}

export async function deleteAutopilot(userId: string): Promise<void> {
  await db().prepare("DELETE FROM autopilots WHERE user_id = ?").bind(userId).run();
}

/**
 * Atomically claim every due autopilot: advances next_run_at and resets the
 * period spend in one UPDATE ... RETURNING, so a row can't be claimed twice.
 * The returned configs already reflect the fresh period (spentThisPeriod = 0).
 */
export async function claimDueAutopilots(nowSeconds: number): Promise<AutopilotConfig[]> {
  const { results } = await db()
    .prepare(
      `UPDATE autopilots SET
         next_run_at = next_run_at + CASE cadence
           WHEN 'daily' THEN 86400 WHEN 'weekly' THEN 604800
           WHEN 'biweekly' THEN 1209600 ELSE 2592000 END,
         spent_this_period = 0
       WHERE active = 1 AND next_run_at <= ?
       RETURNING *`,
    )
    .bind(nowSeconds)
    .run<Row>();
  return (results ?? []).map(rowToConfig);
}

/** Persist run accounting after a successful run. Never touches next_run_at. */
export async function recordRun(
  userId: string,
  patch: { lastRunAt: number; runs: number; spentThisPeriod: number },
): Promise<void> {
  await db()
    .prepare("UPDATE autopilots SET last_run_at = ?, runs = ?, spent_this_period = ? WHERE user_id = ?")
    .bind(patch.lastRunAt, patch.runs, patch.spentThisPeriod, userId)
    .run();
}

export interface RunHolding {
  symbol: string;
  weightPct: number;
  amountUsd: number;
}

export interface RunLog {
  userId: string;
  ranAt: number;
  amountUsd: number;
  assessedRiskBps?: number;
  status: "success" | "skipped" | "error";
  reason?: string;
  txHash?: string;
  holdings?: RunHolding[];
}

interface RunRow {
  user_id: string;
  ran_at: number;
  amount_usd: number;
  assessed_risk_bps: number | null;
  status: RunLog["status"];
  reason: string | null;
  tx_hash: string | null;
  holdings: string | null;
}

/** Recent runs for a user, newest first (the audit trail shown in the app). */
export async function listRuns(userId: string, limit = 20): Promise<RunLog[]> {
  const { results } = await db()
    .prepare("SELECT * FROM autopilot_runs WHERE user_id = ? ORDER BY ran_at DESC LIMIT ?")
    .bind(userId, limit)
    .all<RunRow>();
  return (results ?? []).map((r) => ({
    userId: r.user_id,
    ranAt: r.ran_at,
    amountUsd: r.amount_usd,
    assessedRiskBps: r.assessed_risk_bps ?? undefined,
    status: r.status,
    reason: r.reason ?? undefined,
    txHash: r.tx_hash ?? undefined,
    holdings: r.holdings ? (JSON.parse(r.holdings) as RunHolding[]) : undefined,
  }));
}

/** Append to the audit log. A logging failure must never break a run. */
export async function logRun(entry: RunLog): Promise<void> {
  try {
    await db()
      .prepare(
        `INSERT INTO autopilot_runs (user_id, ran_at, amount_usd, assessed_risk_bps, status, reason, tx_hash, holdings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.userId, entry.ranAt, entry.amountUsd, entry.assessedRiskBps ?? null,
        entry.status, entry.reason ?? null, entry.txHash ?? null,
        entry.holdings ? JSON.stringify(entry.holdings) : null,
      )
      .run();
  } catch (e) {
    console.error("[autopilot] logRun failed:", e instanceof Error ? e.message : e);
  }
}
