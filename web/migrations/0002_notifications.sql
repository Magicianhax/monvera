-- Notification Center + price alerts (roadmap "unlock").
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('alert','autopilot','trade','system')),
  title      TEXT NOT NULL,
  body       TEXT,
  symbol     TEXT,
  tx_hash    TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('above','below')),
  threshold    REAL NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  triggered_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_active_idx ON alerts (active, symbol);
