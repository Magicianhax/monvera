-- Watchlist — server-backed so a wallet's starred tickers follow the user across
-- devices (localStorage stays as an instant/offline cache on the client).
CREATE TABLE IF NOT EXISTS watchlist (
  user_id    TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS watchlist_user_idx ON watchlist (user_id, created_at);
