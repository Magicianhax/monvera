import "server-only";

// Autopilot store — Supabase Postgres (durable source of truth).
//   autopilots      one row per user: the config + run accounting.
//   autopilot_runs  append-only audit log of every run (success/skipped/error).
//
// Scheduling safety: the cron claims due rows via claim_due_autopilots(), an
// atomic UPDATE ... RETURNING that advances next_run_at (and resets the period
// spend) as it reads — so two overlapping cron invocations can never run the same
// autopilot twice. recordRun() therefore never touches next_run_at; the claim owns
// the schedule. See supabase/migrations/*_autopilot.sql.
import type { AutopilotConfig } from "@/lib/autopilot";
import { supabaseAdmin } from "@/lib/server/supabase";

const TABLE = "autopilots";

type Row = Record<string, unknown>;

function rowToConfig(r: Row): AutopilotConfig {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    walletId: String(r.wallet_id),
    owner: r.owner as `0x${string}`,
    smartAccount: r.smart_account as `0x${string}`,
    goal: String(r.goal),
    amountUsd: Number(r.amount_usd),
    cadence: r.cadence as AutopilotConfig["cadence"],
    riskCeilingBps: Number(r.risk_ceiling_bps),
    maxPerPeriodUsd: Number(r.max_per_period_usd),
    active: Boolean(r.active),
    createdAt: Number(r.created_at),
    nextRunAt: Number(r.next_run_at),
    lastRunAt: r.last_run_at == null ? undefined : Number(r.last_run_at),
    runs: Number(r.runs),
    spentThisPeriod: Number(r.spent_this_period),
  };
}

function configToRow(c: AutopilotConfig) {
  return {
    user_id: c.userId,
    id: c.id,
    wallet_id: c.walletId,
    owner: c.owner,
    smart_account: c.smartAccount,
    goal: c.goal,
    amount_usd: c.amountUsd,
    cadence: c.cadence,
    risk_ceiling_bps: c.riskCeilingBps,
    max_per_period_usd: c.maxPerPeriodUsd,
    active: c.active,
    created_at: c.createdAt,
    next_run_at: c.nextRunAt,
    last_run_at: c.lastRunAt ?? null,
    runs: c.runs,
    spent_this_period: c.spentThisPeriod,
  };
}

export async function getAutopilot(userId: string): Promise<AutopilotConfig | null> {
  const { data, error } = await supabaseAdmin().from(TABLE).select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToConfig(data) : null;
}

export async function upsertAutopilot(cfg: AutopilotConfig): Promise<AutopilotConfig> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .upsert(configToRow(cfg), { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return rowToConfig(data);
}

export async function deleteAutopilot(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().from(TABLE).delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Atomically claim every due autopilot: advances next_run_at and resets the
 * period spend in one UPDATE ... RETURNING, so a row can't be claimed twice.
 * The returned configs already reflect the fresh period (spentThisPeriod = 0).
 */
export async function claimDueAutopilots(nowSeconds: number): Promise<AutopilotConfig[]> {
  const { data, error } = await supabaseAdmin().rpc("claim_due_autopilots", { now_seconds: nowSeconds });
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map(rowToConfig);
}

/** Persist run accounting after a successful run. Never touches next_run_at. */
export async function recordRun(
  userId: string,
  patch: { lastRunAt: number; runs: number; spentThisPeriod: number },
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from(TABLE)
    .update({ last_run_at: patch.lastRunAt, runs: patch.runs, spent_this_period: patch.spentThisPeriod })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
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

/** Recent runs for a user, newest first (the audit trail shown in the app). */
export async function listRuns(userId: string, limit = 20): Promise<RunLog[]> {
  const { data, error } = await supabaseAdmin()
    .from("autopilot_runs")
    .select("*")
    .eq("user_id", userId)
    .order("ran_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    userId: String(r.user_id),
    ranAt: Number(r.ran_at),
    amountUsd: Number(r.amount_usd),
    assessedRiskBps: r.assessed_risk_bps == null ? undefined : Number(r.assessed_risk_bps),
    status: r.status as RunLog["status"],
    reason: r.reason == null ? undefined : String(r.reason),
    txHash: r.tx_hash == null ? undefined : String(r.tx_hash),
    holdings: Array.isArray(r.holdings) ? (r.holdings as RunHolding[]) : undefined,
  }));
}

/** Append to the audit log. A logging failure must never break a run. */
export async function logRun(entry: RunLog): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("autopilot_runs").insert({
      user_id: entry.userId,
      ran_at: entry.ranAt,
      amount_usd: entry.amountUsd,
      assessed_risk_bps: entry.assessedRiskBps ?? null,
      status: entry.status,
      reason: entry.reason ?? null,
      tx_hash: entry.txHash ?? null,
      holdings: entry.holdings ?? null,
    });
    if (error) console.error("[autopilot] logRun failed:", error.message);
  } catch (e) {
    console.error("[autopilot] logRun threw:", e instanceof Error ? e.message : e);
  }
}
