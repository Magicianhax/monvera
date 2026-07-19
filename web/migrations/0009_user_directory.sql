-- User directory: userId -> wallet, written on each authed Vera turn.
-- Lets fleet-wide sends (the weekly brief) reach every signed-in user, not
-- just the ones with an active autopilot row.
CREATE TABLE IF NOT EXISTS user_directory (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  last_seen INTEGER NOT NULL
);
