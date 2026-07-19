-- Vera as a proper agent: persistent chat history for the chat-first UI.
--   vera_threads   one row per conversation, owned by the authenticated Privy
--                  user (verifyRequest userId — NOT a client-supplied address,
--                  so one user can never read another's history)
--   vera_messages  every message both ways; `kind` marks rich cards (plan,
--                  invest success, portfolio greeting) whose structured data
--                  rides in `payload` (JSON) so the UI re-renders them exactly.
-- Applied with: npx wrangler d1 migrations apply monvera [--remote]

CREATE TABLE IF NOT EXISTS vera_threads (
  id         TEXT PRIMARY KEY,            -- uuid
  owner      TEXT NOT NULL,               -- Privy userId from the verified bearer
  title      TEXT NOT NULL DEFAULT 'New session',
  created_at INTEGER NOT NULL,            -- unix seconds
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vera_threads_owner_idx ON vera_threads (owner, updated_at DESC);

CREATE TABLE IF NOT EXISTS vera_messages (
  id         TEXT PRIMARY KEY,            -- uuid
  thread_id  TEXT NOT NULL REFERENCES vera_threads(id),
  role       TEXT NOT NULL,               -- 'user' | 'vera'
  kind       TEXT NOT NULL DEFAULT 'text',-- 'text' | 'plan' | 'success' | 'portfolio'
  content    TEXT NOT NULL DEFAULT '',    -- the visible text
  payload    TEXT,                        -- JSON: AllocateResult / InvestSuccess / …
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vera_messages_thread_idx ON vera_messages (thread_id, created_at);
