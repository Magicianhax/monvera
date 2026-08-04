import "server-only";

// The auto-manage ledger — Cloudflare D1 (schema: migrations/0012). Same store
// pattern as notifyStore: bindings, no credentials.
//
// Fail closed, record truthfully (automanage-strategy §1). Every WRITE is
// best-effort: a ledger outage must never stop or delay a rebalance, so
// writers catch, log, and answer through their return value instead of
// throwing. READS backing repair or surfaces (listUnconfirmed, latestRuns)
// throw instead — "none pending" and "ledger unreachable" must never look
// alike to a caller deciding whether it is safe to proceed.
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

/** How far a window got before stopping. "acted" means the full pipeline ran
 *  (the counts say what happened inside it); everything else names the gate
 *  that stopped it. A row with NULL gate AND NULL finished_at is a run that
 *  crashed mid-window. */
// "off-session" survives for rows written before the wall-clock gate was
// dropped (2026-08-04, feeds-freshness is the only session gate now).
export type RunGate = "acted" | "off-session" | "stale-feeds" | "killed" | "locked" | "gas-floor";

/** The truthful per-user taxonomy. "unconfirmed" is a receipt timeout — mined
 *  status unknown, never a failure; "pricing-unavailable" is an outage, never
 *  "no-drift"; "defer-market" is Vera's judgment, "defer-outage" is Vera being
 *  unreachable. */
export type RebalanceOutcome =
  | "rebalanced"
  | "no-drift"
  | "off-session"
  | "pricing-unavailable"
  | "defer-market"
  | "defer-outage"
  | "skipped"
  | "failed"
  | "unconfirmed";

/** One swap leg as quoted. Raw uint256 values may be passed as bigint; they
 *  are stored, and read back, as decimal strings — exact at any magnitude,
 *  hand-readable in the D1 console. `realized` stays null until receipt
 *  decoding exists; the field is here for when it does. */
export interface RebalanceLeg {
  symbol: string;
  side: "sell" | "buy";
  amountIn: bigint | string;
  expected: bigint | string;
  minOut: bigint | string;
  oracleAnswer: bigint | string;
  realized: bigint | string | null;
}

export interface RebalanceOutcomeInput {
  runId: string;
  /** Registry id from groves.ts (e.g. "titan"), not the chain id. */
  groveId: string;
  user: string;
  outcome: RebalanceOutcome;
  reason?: string;
  txHash?: string;
  turnoverUsd?: number;
  /** Vera's one-sentence timing rationale — shown to the user, must be honest. */
  veraReason?: string;
  /** R9 reason-lint flag; omit when no verdict was involved. */
  lintOk?: boolean;
  legs?: RebalanceLeg[];
  at: number;
}

export interface RebalanceOutcomeRow {
  id: number;
  runId: string;
  groveId: string;
  user: string;
  outcome: RebalanceOutcome;
  reason?: string;
  txHash?: string;
  turnoverUsd?: number;
  veraReason?: string;
  lintOk?: boolean;
  notified: boolean;
  legs?: RebalanceLeg[];
  createdAt: number;
  updatedAt: number;
}

export interface RunSummary {
  startedAt: number;
  finishedAt: number;
  gate: RunGate;
  counts: Partial<Record<RebalanceOutcome, number>>;
  error?: string;
}

export interface RebalanceRunRow {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  gate?: RunGate;
  error?: string;
  counts: Record<RebalanceOutcome, number>;
}

export type BudgetNoticeKind = "low-water" | "exhausted";

interface ORow {
  id: number;
  run_id: string;
  grove_id: string;
  user: string;
  outcome: RebalanceOutcome;
  reason: string | null;
  tx_hash: string | null;
  turnover_usd: number | null;
  vera_reason: string | null;
  lint_ok: number | null;
  notified: number;
  legs: string | null;
  created_at: number;
  updated_at: number;
}
interface RRow {
  run_id: string;
  started_at: number;
  finished_at: number | null;
  gate: RunGate | null;
  error: string | null;
  n_rebalanced: number;
  n_no_drift: number;
  n_off_session: number;
  n_pricing_unavailable: number;
  n_defer_market: number;
  n_defer_outage: number;
  n_skipped: number;
  n_failed: number;
  n_unconfirmed: number;
}

function packLegs(legs: RebalanceLeg[]): string {
  return JSON.stringify(legs, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
function parseLegs(raw: string | null): RebalanceLeg[] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as RebalanceLeg[];
  } catch {
    return undefined; // one corrupt blob must not take down the repair pass
  }
}

function rowToOutcome(r: ORow): RebalanceOutcomeRow {
  return {
    id: r.id, runId: r.run_id, groveId: r.grove_id, user: r.user, outcome: r.outcome,
    reason: r.reason ?? undefined, txHash: r.tx_hash ?? undefined,
    turnoverUsd: r.turnover_usd ?? undefined, veraReason: r.vera_reason ?? undefined,
    lintOk: r.lint_ok === null ? undefined : Boolean(r.lint_ok),
    notified: Boolean(r.notified), legs: parseLegs(r.legs),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToRun(r: RRow): RebalanceRunRow {
  return {
    runId: r.run_id, startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined, gate: r.gate ?? undefined, error: r.error ?? undefined,
    counts: {
      rebalanced: r.n_rebalanced, "no-drift": r.n_no_drift, "off-session": r.n_off_session,
      "pricing-unavailable": r.n_pricing_unavailable, "defer-market": r.n_defer_market,
      "defer-outage": r.n_defer_outage, skipped: r.n_skipped, failed: r.n_failed,
      unconfirmed: r.n_unconfirmed,
    },
  };
}

/** Canonical run id: the most recent scheduled fire as an ISO instant. The
 *  schedule is 00/06/12/18 UTC daily plus 13:30 UTC on weekdays (the
 *  market-open fire) — this MUST mirror wrangler.jsonc's rebalance crons, or
 *  the open run would collide with the 12:00 window's ledger row and the
 *  already-acted guard would bail it. The KV run lock keys on the same
 *  string, and repeated fires inside one window collapse onto one ledger
 *  row. Pure — safe outside a CF context. */
export function runIdForWindow(at = Date.now()): string {
  const d = new Date(at);
  let best = Number.NEGATIVE_INFINITY;
  for (let dayOff = -1; dayOff <= 0; dayOff++) {
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOff);
    for (const [h, m] of [[0, 0], [6, 0], [12, 0], [13, 30], [18, 0]] as const) {
      const t = base + (h * 60 + m) * 60_000;
      const day = new Date(t).getUTCDay();
      if (m === 30 && (day === 0 || day === 6)) continue; // open fire is weekdays only
      if (t <= at && t > best) best = t;
    }
  }
  return new Date(best).toISOString();
}

/** Open the window's run row. Idempotent: a second fire in the same window
 *  keeps the first started_at. Best-effort — false means the write was lost,
 *  never thrown. */
export async function recordRunStart(runId: string, startedAt: number): Promise<boolean> {
  try {
    await db()
      .prepare("INSERT INTO rebalance_runs (run_id, started_at) VALUES (?, ?) ON CONFLICT (run_id) DO NOTHING")
      .bind(runId, startedAt)
      .run();
    return true;
  } catch (e) {
    console.error("[rebalance-ledger] run start failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Close the run row: gate, per-outcome counts, error text. Upserts so a
 *  finish still lands even when the start write was lost (startedAt rides
 *  along for exactly that case; an existing row keeps its own). Best-effort. */
export async function recordRunFinish(runId: string, s: RunSummary): Promise<boolean> {
  const c = (k: RebalanceOutcome) => s.counts[k] ?? 0;
  try {
    await db()
      .prepare(
        `INSERT INTO rebalance_runs (run_id, started_at, finished_at, gate, error,
           n_rebalanced, n_no_drift, n_off_session, n_pricing_unavailable,
           n_defer_market, n_defer_outage, n_skipped, n_failed, n_unconfirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET
           finished_at = excluded.finished_at, gate = excluded.gate, error = excluded.error,
           n_rebalanced = excluded.n_rebalanced, n_no_drift = excluded.n_no_drift,
           n_off_session = excluded.n_off_session, n_pricing_unavailable = excluded.n_pricing_unavailable,
           n_defer_market = excluded.n_defer_market, n_defer_outage = excluded.n_defer_outage,
           n_skipped = excluded.n_skipped, n_failed = excluded.n_failed,
           n_unconfirmed = excluded.n_unconfirmed`,
      )
      .bind(
        runId, s.startedAt, s.finishedAt, s.gate, s.error ?? null,
        c("rebalanced"), c("no-drift"), c("off-session"), c("pricing-unavailable"),
        c("defer-market"), c("defer-outage"), c("skipped"), c("failed"), c("unconfirmed"),
      )
      .run();
    return true;
  } catch (e) {
    console.error("[rebalance-ledger] run finish failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Outcomes that describe MONEY the chain was asked to move. Once a row holds
 *  one, a bookkeeping overwrite (skipped/cooldown/no-drift from a same-window
 *  re-fire) must never erase it — that re-fire is exactly the case where the
 *  contract's cooldown makes the user look "skipped" while the truth is
 *  "rebalanced two minutes ago, here is the hash". */
const TERMINAL = "('rebalanced','unconfirmed','failed')";

/** Record one candidate's outcome, keyed (runId, groveId, user) — writing the
 *  same key again replaces the verdict fields but keeps created_at and the
 *  notified flag (only markNotified touches that), and a terminal outcome is
 *  never downgraded by a non-terminal one. Returns the row id (the surviving
 *  row's, when the guard preserved it), or null when the write was lost.
 *  Best-effort. */
export async function upsertOutcome(o: RebalanceOutcomeInput): Promise<number | null> {
  try {
    const { results } = await db()
      .prepare(
        `INSERT INTO rebalance_outcomes
           (run_id, grove_id, user, outcome, reason, tx_hash, turnover_usd, vera_reason, lint_ok, legs, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id, grove_id, user) DO UPDATE SET
           outcome = excluded.outcome, reason = excluded.reason, tx_hash = excluded.tx_hash,
           turnover_usd = excluded.turnover_usd, vera_reason = excluded.vera_reason,
           lint_ok = excluded.lint_ok, legs = excluded.legs, updated_at = excluded.updated_at
         WHERE NOT (rebalance_outcomes.outcome IN ${TERMINAL}
                    AND excluded.outcome NOT IN ${TERMINAL})
         RETURNING id`,
      )
      .bind(
        o.runId, o.groveId, o.user.toLowerCase(), o.outcome, o.reason ?? null, o.txHash ?? null,
        o.turnoverUsd ?? null, o.veraReason ?? null,
        o.lintOk === undefined ? null : o.lintOk ? 1 : 0,
        o.legs ? packLegs(o.legs) : null, o.at, o.at,
      )
      .run<{ id: number }>();
    const id = results?.[0]?.id;
    if (id !== undefined) return id;
    // No row returned: either the guard preserved a terminal row (fine — hand
    // back its id) or the write really was lost (null).
    const kept = await db()
      .prepare("SELECT id FROM rebalance_outcomes WHERE run_id = ? AND grove_id = ? AND user = ?")
      .bind(o.runId, o.groveId, o.user.toLowerCase())
      .first<{ id: number }>();
    return kept?.id ?? null;
  } catch (e) {
    console.error("[rebalance-ledger] outcome upsert failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Flag an outcome's user as notified (§6 metric 2 counts on this — target is
 *  exactly 100% of rebalanced). Best-effort; false = row missing or write lost. */
export async function markNotified(id: number): Promise<boolean> {
  try {
    const { results } = await db()
      .prepare("UPDATE rebalance_outcomes SET notified = 1 WHERE id = ? RETURNING id")
      .bind(id)
      .run<{ id: number }>();
    return (results ?? []).length > 0;
  } catch (e) {
    console.error("[rebalance-ledger] mark notified failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Unresolved receipt timeouts, oldest first — the preflight repair worklist.
 *  THROWS on D1 failure: repair must be able to tell "none pending" from
 *  "ledger unreachable", and an unreadable ledger halts the window (fail
 *  closed), the same as the kill switch. */
export async function listUnconfirmed(limit = 20): Promise<RebalanceOutcomeRow[]> {
  const { results } = await db()
    .prepare("SELECT * FROM rebalance_outcomes WHERE outcome = 'unconfirmed' ORDER BY created_at ASC LIMIT ?")
    .bind(limit)
    .all<ORow>();
  return (results ?? []).map(rowToOutcome);
}

/** Rebalanced rows whose user was never told (recent only) — the notification
 *  repair worklist: a crash between the send and the end-of-pass notification
 *  loop is money that moved silently, and §6 metric 2 exists to make that
 *  impossible to miss. Best-effort read (an unreadable ledger already halted
 *  the window upstream via listUnconfirmed): [] on failure, logged. */
export async function listUnnotified(limit = 20, now = Date.now()): Promise<RebalanceOutcomeRow[]> {
  try {
    const since = now - 7 * 24 * 3600 * 1000;
    const { results } = await db()
      .prepare(
        `SELECT * FROM rebalance_outcomes
         WHERE outcome = 'rebalanced' AND notified = 0 AND tx_hash IS NOT NULL AND created_at > ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .bind(since, limit)
      .all<ORow>();
    return (results ?? []).map(rowToOutcome);
  } catch (e) {
    console.error("[rebalance-ledger] unnotified read failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Settle an unconfirmed row once the receipt arrived: mined-success becomes
 *  "rebalanced", mined-revert becomes "failed". Only flips rows still
 *  unconfirmed, so true means this call resolved it (safe to send the late
 *  notification exactly once). Best-effort. */
export async function resolveUnconfirmed(id: number, outcome: RebalanceOutcome, reason?: string): Promise<boolean> {
  try {
    const { results } = await db()
      .prepare(
        `UPDATE rebalance_outcomes SET outcome = ?, reason = COALESCE(?, reason), updated_at = ?
         WHERE id = ? AND outcome = 'unconfirmed' RETURNING id`,
      )
      .bind(outcome, reason ?? null, Date.now(), id)
      .run<{ id: number }>();
    return (results ?? []).length > 0;
  } catch (e) {
    console.error("[rebalance-ledger] resolve unconfirmed failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Most recent windows, newest first — pass history for the panel, digest,
 *  and admin surfaces. THROWS on D1 failure; surfaces show their own error
 *  state rather than an empty history that reads as "never ran". */
export async function latestRuns(limit = 30): Promise<RebalanceRunRow[]> {
  const { results } = await db()
    .prepare("SELECT * FROM rebalance_runs ORDER BY started_at DESC LIMIT ?")
    .bind(limit)
    .all<RRow>();
  return (results ?? []).map(rowToRun);
}

/** Was ANY notice of this kind sent recently, regardless of the moved value?
 *  The low-water dedup needs this: every budget-consuming action changes
 *  managerMovedUsdg, so the exact-value key alone would re-notice after each
 *  action in the 75-100% tail. One low-water note per 30 days is the honest
 *  cadence — the meter is on the panel for anyone watching closer. Returns
 *  true on ledger failure (suppress beats duplicate). */
export async function wasBudgetNoticeRecent(
  user: string,
  groveId: string,
  kind: BudgetNoticeKind,
  windowMs = 30 * 24 * 3600 * 1000,
  now = Date.now(),
): Promise<boolean> {
  try {
    const row = await db()
      .prepare("SELECT 1 AS one FROM rebalance_budget_notices WHERE user = ? AND grove_id = ? AND kind = ? AND sent_at > ? LIMIT 1")
      .bind(user.toLowerCase(), groveId, kind, now - windowMs)
      .first<{ one: number }>();
    return row !== null;
  } catch (e) {
    console.error("[rebalance-ledger] budget notice recent read failed:", e instanceof Error ? e.message : e);
    return true;
  }
}

/** Claim the notice key. True means THIS call claimed it — send the
 *  notification only then, so concurrent passes and ledger outages both
 *  resolve to at-most-once. Best-effort; false = already sent or write lost. */
export async function markBudgetNoticeSent(
  user: string,
  groveId: string,
  movedUsdg: bigint,
  kind: BudgetNoticeKind,
): Promise<boolean> {
  try {
    const { results } = await db()
      .prepare(
        `INSERT INTO rebalance_budget_notices (user, grove_id, kind, moved_usdg, sent_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user, grove_id, kind, moved_usdg) DO NOTHING RETURNING user`,
      )
      .bind(user.toLowerCase(), groveId, kind, movedUsdg.toString(), Date.now())
      .run<{ user: string }>();
    return (results ?? []).length > 0;
  } catch (e) {
    console.error("[rebalance-ledger] budget notice claim failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

const RETENTION_MS = 90 * 24 * 3600 * 1000;

/** Drop runs and outcomes older than 90 days. Unconfirmed rows are exempt —
 *  an unresolved receipt is money whose fate is unknown, and it must never
 *  age out silently. Budget notices are never pruned (see migration 0012).
 *  Best-effort. */
export async function pruneLedger(now = Date.now()): Promise<boolean> {
  const cutoff = now - RETENTION_MS;
  try {
    await db().prepare("DELETE FROM rebalance_outcomes WHERE created_at < ? AND outcome != 'unconfirmed'").bind(cutoff).run();
    await db().prepare("DELETE FROM rebalance_runs WHERE started_at < ?").bind(cutoff).run();
    return true;
  } catch (e) {
    console.error("[rebalance-ledger] prune failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
