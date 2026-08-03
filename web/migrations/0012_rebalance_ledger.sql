-- Auto-manage ledger (automanage-strategy §3 stage 9): one row per six-hour
-- window, one row per (window, grove, user) the pass touched. Fail closed,
-- record truthfully — "pricing was down" is never "no drift"; a receipt
-- timeout is "unconfirmed", never "failed". This is the record the panel,
-- digest, and admin surfaces read, and the dedup source for consent-meter
-- notices.
--
-- No CHECK constraints on gate/outcome: every write here is best-effort, and
-- a row rejected over a label the taxonomy grew later would be a silent hole
-- in the ledger — worse than any label. The TS unions in rebalanceStore.ts
-- gate the values. Timestamps are epoch milliseconds (Date.now()), matching
-- notifications.
-- Apply BEFORE the deploy that writes here:
--   npx wrangler d1 migrations apply monvera --remote

CREATE TABLE IF NOT EXISTS rebalance_runs (
  run_id      TEXT PRIMARY KEY,           -- 6h window start, ISO; same key as the KV run lock
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,                    -- NULL with gate NULL = the run crashed mid-window
  gate        TEXT,                       -- acted | off-session | stale-feeds | killed | locked | gas-floor
  error       TEXT,
  -- Outcome counts denormalized so pass-health surfaces never need the join.
  n_rebalanced          INTEGER NOT NULL DEFAULT 0,
  n_no_drift            INTEGER NOT NULL DEFAULT 0,
  n_off_session         INTEGER NOT NULL DEFAULT 0,
  n_pricing_unavailable INTEGER NOT NULL DEFAULT 0,
  n_defer_market        INTEGER NOT NULL DEFAULT 0,
  n_defer_outage        INTEGER NOT NULL DEFAULT 0,
  n_skipped             INTEGER NOT NULL DEFAULT 0,
  n_failed              INTEGER NOT NULL DEFAULT 0,
  n_unconfirmed         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rebalance_runs_started_idx ON rebalance_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS rebalance_outcomes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  grove_id     TEXT NOT NULL,             -- registry id from groves.ts, not the chain id
  user         TEXT NOT NULL,             -- lowercase address of the position owner
  outcome      TEXT NOT NULL,             -- rebalanced | no-drift | off-session | pricing-unavailable | defer-market | defer-outage | skipped | failed | unconfirmed
  reason       TEXT,
  tx_hash      TEXT,
  turnover_usd REAL,
  vera_reason  TEXT,                      -- Vera's one-sentence timing rationale, shown to the user
  lint_ok      INTEGER,                   -- R9 reason-lint flag; NULL = no verdict involved in this row
  notified     INTEGER NOT NULL DEFAULT 0,
  -- Per-leg instrumentation (§6 metric 5): JSON array of {symbol, side,
  -- amountIn, expected, minOut, oracleAnswer, realized}, raw uint256 amounts
  -- as decimal strings. realized is null until receipt decoding lands — the
  -- field exists for when it does.
  legs         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (run_id, grove_id, user)         -- the upsert key; its index also serves run-detail lookups
);
CREATE INDEX IF NOT EXISTS rebalance_outcomes_outcome_idx ON rebalance_outcomes (outcome, created_at);
CREATE INDEX IF NOT EXISTS rebalance_outcomes_created_idx ON rebalance_outcomes (created_at);

-- Consent-meter notice dedup (R8): one row per notice actually sent, keyed on
-- the on-chain managerMovedUsdg value — re-signing enableAuto resets the spent
-- counter, so the value doubles as the budget epoch. Never pruned: dropping a
-- key would re-notify a user whose budget simply sat exhausted past retention.
CREATE TABLE IF NOT EXISTS rebalance_budget_notices (
  user       TEXT NOT NULL,               -- lowercase address
  grove_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,               -- low-water | exhausted
  moved_usdg TEXT NOT NULL,               -- uint256 micro-USDG as decimal string
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user, grove_id, kind, moved_usdg)
);
