-- News alert ledger: what Vera has already told which user about, so the
-- per-(user,symbol) cooldown and the per-user daily cap are exact.
--
-- Additive only. Migration 0002's `kind` CHECK is NOT touched: SQLite cannot
-- ALTER a CHECK and a table rebuild is not worth it, so news notifications ship
-- under the existing 'alert' kind.
--
-- sent_at is epoch MILLISECONDS, matching notifications.created_at.
CREATE TABLE IF NOT EXISTS news_sends (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  symbol  TEXT NOT NULL,
  guid    TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS news_sends_user_idx ON news_sends (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS news_sends_user_symbol_idx ON news_sends (user_id, symbol, sent_at DESC);
