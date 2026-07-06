// Autopilot — Vera's autonomous, bounded investing strategy.
//
// The user delegates their embedded wallet to Monvera (Privy session signer) and
// sets a recurring plan with HARD bounds. A scheduled server job (cron) then has
// Vera re-allocate and execute `investWithAI` gaslessly on their behalf — without
// the user signing each run — but only ever within the limits they authorized.
//
// This module is the dependency-free core: the config shape, cadence math, and
// the bounds checks that gate every autonomous run. The signing/execution engine
// (server) and the grant/configure UI (client) build on top of this.

export type Cadence = "daily" | "weekly" | "biweekly" | "monthly";

export const CADENCE_SECONDS: Record<Cadence, number> = {
  daily: 86_400,
  weekly: 604_800,
  biweekly: 1_209_600,
  monthly: 2_592_000,
};

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: "Every day",
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
};

export interface AutopilotConfig {
  id: string;
  /** Privy user id (owner of this autopilot). */
  userId: string;
  /** Privy embedded-wallet id — the server signs UserOps for this wallet. */
  walletId: string;
  /** Embedded EOA that owns the smart account. */
  owner: `0x${string}`;
  /** The smart-account address that holds funds and executes. */
  smartAccount: `0x${string}`;
  /** Plain-language goal Vera re-allocates against each run. */
  goal: string;
  /** Contribution per run, USD. */
  amountUsd: number;
  cadence: Cadence;
  /** Risk ceiling the user authorized (bps) — Vera may never exceed it. */
  riskCeilingBps: number;
  /** Hard spend cap per cadence period, USD — a run that would exceed it is skipped. */
  maxPerPeriodUsd: number;
  active: boolean;
  createdAt: number; // unix seconds
  nextRunAt: number; // unix seconds
  lastRunAt?: number;
  /** Completed autonomous runs. */
  runs: number;
  /** USD deployed in the current period (reset each period) — enforces maxPerPeriod. */
  spentThisPeriod: number;
}

/** Default bounds for a new autopilot (conservative, user-adjustable). */
export const AUTOPILOT_DEFAULTS = {
  cadence: "weekly" as Cadence,
  riskCeilingBps: 6000, // ~moderate; AI's assessed risk must stay at/under this
  maxPerPeriodMultiplier: 2, // maxPerPeriod = amount * this (a little headroom)
};

/** Next run timestamp for a cadence starting at `from` (unix seconds). */
export function nextRunAfter(from: number, cadence: Cadence): number {
  return from + CADENCE_SECONDS[cadence];
}

/** A run is due when active and the clock has reached nextRunAt. */
export function isDue(cfg: AutopilotConfig, nowSeconds: number): boolean {
  return cfg.active && nowSeconds >= cfg.nextRunAt;
}

export interface BoundsCheck {
  ok: boolean;
  reason?: string;
}

/**
 * The gate every autonomous run must pass. Enforces the user's authorized
 * limits BEFORE anything is signed or executed — the core safety guarantee.
 */
export function checkBounds(
  cfg: AutopilotConfig,
  ctx: { availableUsd: number; assessedRiskBps: number },
): BoundsCheck {
  if (!cfg.active) return { ok: false, reason: "Autopilot is paused." };
  if (cfg.amountUsd <= 0) return { ok: false, reason: "No contribution amount set." };
  if (ctx.availableUsd + 1e-6 < cfg.amountUsd) {
    return { ok: false, reason: "Not enough cash for this run." };
  }
  if (cfg.spentThisPeriod + cfg.amountUsd > cfg.maxPerPeriodUsd + 1e-6) {
    return { ok: false, reason: "Period spend cap reached." };
  }
  if (ctx.assessedRiskBps > cfg.riskCeilingBps) {
    return { ok: false, reason: "Plan exceeds your risk ceiling." };
  }
  return { ok: true };
}

/** Human cadence + amount summary, e.g. "$25 every week". */
export function summarize(cfg: Pick<AutopilotConfig, "amountUsd" | "cadence">): string {
  return `$${cfg.amountUsd} ${CADENCE_LABEL[cfg.cadence].toLowerCase()}`;
}
