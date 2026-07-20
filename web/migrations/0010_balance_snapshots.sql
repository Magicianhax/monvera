-- Hourly balance snapshots: the real equity curve behind the "Total balance"
-- chart. The hourly cron (/api/cron/balances) values every address in
-- user_directory through the same valuation as /api/portfolio and appends one
-- row per address per hour. Served by /api/balance-history.
-- Applied with: npx wrangler d1 migrations apply monvera [--remote]

CREATE TABLE IF NOT EXISTS balance_snapshots (
  address    TEXT NOT NULL,               -- lowercase 0x wallet
  taken_at   INTEGER NOT NULL,            -- unix seconds, floored to the hour
  cash_usd   REAL NOT NULL,
  invested_usd REAL NOT NULL,
  total_usd  REAL NOT NULL,
  PRIMARY KEY (address, taken_at)
);
CREATE INDEX IF NOT EXISTS balance_snapshots_addr_idx ON balance_snapshots (address, taken_at DESC);
