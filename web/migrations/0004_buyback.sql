-- Monvera buyback transparency — D1 (SQLite) store.
--   buybacks           append-only log of each on-chain buy (USDG -> MONVERA)
--                      executed from the treasury wallet.
--   treasury_expenses  manual expense entries; summed and deducted from revenue
--                      BEFORE the 20% buyback split is computed.
-- Applied with: npx wrangler d1 migrations apply monvera --remote

CREATE TABLE IF NOT EXISTS buybacks (
  tx_hash        TEXT PRIMARY KEY,        -- the swap tx (idempotency key)
  block_number   INTEGER NOT NULL,
  bought_at      INTEGER NOT NULL,        -- unix seconds
  monvera_amount REAL NOT NULL,           -- MONVERA received (whole tokens)
  usdg_spent     REAL NOT NULL,           -- USDG spent (~USD)
  price_usd      REAL NOT NULL            -- usdg_spent / monvera_amount
);
CREATE INDEX IF NOT EXISTS buybacks_time_idx ON buybacks (bought_at);

CREATE TABLE IF NOT EXISTS treasury_expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  spent_at    INTEGER NOT NULL,           -- unix seconds
  description TEXT NOT NULL,
  amount_usd  REAL NOT NULL
);

-- Seed expenses. Only positive amounts are deducted before the 20% split; a $0
-- amount means the line is shown for transparency but currently costs nothing.
INSERT INTO treasury_expenses (spent_at, description, amount_usd)
SELECT CAST(strftime('%s','now') AS INTEGER), 'DexScreener token verification', 299
WHERE NOT EXISTS (SELECT 1 FROM treasury_expenses WHERE description = 'DexScreener token verification');

-- The agent's largest running cost (AI inference) is currently covered by Virtuals
-- via weekly inference credits, so it is not deducted right now.
INSERT INTO treasury_expenses (spent_at, description, amount_usd)
SELECT CAST(strftime('%s','now') AS INTEGER), 'Agent inference — covered by Virtuals (in progress)', 0
WHERE NOT EXISTS (SELECT 1 FROM treasury_expenses WHERE description LIKE 'Agent inference%');
