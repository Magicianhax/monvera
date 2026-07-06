-- Monvera Autopilot — D1 (SQLite) store: one config per user + append-only run log.
-- Applied with: npx wrangler d1 migrations apply monvera --remote

CREATE TABLE IF NOT EXISTS autopilots (
  user_id            TEXT PRIMARY KEY,         -- Privy user id (one autopilot per user)
  id                 TEXT NOT NULL,
  wallet_id          TEXT NOT NULL,            -- Privy embedded-wallet id (server signs for this)
  owner              TEXT NOT NULL,            -- embedded EOA (smart-account owner)
  smart_account      TEXT NOT NULL,            -- the AA address that holds funds + executes
  goal               TEXT NOT NULL,
  amount_usd         REAL NOT NULL,
  cadence            TEXT NOT NULL CHECK (cadence IN ('daily','weekly','biweekly','monthly')),
  risk_ceiling_bps   INTEGER NOT NULL,
  max_per_period_usd REAL NOT NULL,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,         -- unix seconds
  next_run_at        INTEGER NOT NULL,         -- unix seconds
  last_run_at        INTEGER,
  runs               INTEGER NOT NULL DEFAULT 0,
  spent_this_period  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS autopilots_due_idx ON autopilots (next_run_at) WHERE active = 1;

CREATE TABLE IF NOT EXISTS autopilot_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL,
  ran_at            INTEGER NOT NULL,          -- unix seconds
  amount_usd        REAL NOT NULL,
  assessed_risk_bps INTEGER,
  status            TEXT NOT NULL CHECK (status IN ('success','skipped','error')),
  reason            TEXT,
  tx_hash           TEXT,
  holdings          TEXT                        -- JSON: [{symbol,weightPct,amountUsd}]
);
CREATE INDEX IF NOT EXISTS autopilot_runs_user_idx ON autopilot_runs (user_id, ran_at DESC);
