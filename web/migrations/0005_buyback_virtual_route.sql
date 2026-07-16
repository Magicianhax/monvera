-- Buybacks route USDG -> VIRTUAL -> MONVERA across TWO separate txs, because the
-- direct MONVERA/USDG pool is too thin to route through (see lib/monveraToken.ts):
--   1. FUNDING leg  USDG out of the treasury, VIRTUAL in   (USDG -> VIRTUAL)
--   2. BUYBACK leg  VIRTUAL out of the treasury, MONVERA in (VIRTUAL -> MONVERA)
-- The buyback leg carries no USDG, so we can no longer read its USD cost from the
-- tx alone. Track the funding legs here; each buyback is priced from the
-- treasury's weighted-average VIRTUAL cost basis (Σ usdg_spent / Σ virtual_bought).
-- Applied with: npx wrangler d1 migrations apply monvera [--remote]

-- Routed buybacks record the VIRTUAL they spent; usdg_spent/price_usd are then
-- derived at read time from the cost basis. Direct buybacks (if a pool ever
-- exists) keep virtual_spent = 0 and use usdg_spent directly.
ALTER TABLE buybacks ADD COLUMN virtual_spent REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS treasury_funding (
  tx_hash        TEXT PRIMARY KEY,        -- the USDG -> VIRTUAL swap tx (idempotency key)
  block_number   INTEGER NOT NULL,
  funded_at      INTEGER NOT NULL,        -- unix seconds
  usdg_spent     REAL NOT NULL,           -- USDG spent acquiring VIRTUAL (~USD)
  virtual_bought REAL NOT NULL            -- VIRTUAL received
);
CREATE INDEX IF NOT EXISTS treasury_funding_time_idx ON treasury_funding (funded_at);

-- Backfill the first buyback (2026-07-16 UTC), which landed before this two-leg
-- fix so the old single-tx indexer skipped it. Values decoded from the receipts:
--   funding 0x20a4… : 500 USDG -> 813.152452 VIRTUAL           (block 10808814)
--   buyback 0x507b… : 812.163331 VIRTUAL -> 644,535.886286 MONVERA (block 10811286)
-- => cost basis 0.61489 USDG/VIRTUAL, ~$499.39 spent, ~$0.000775 per MONVERA.
INSERT OR IGNORE INTO treasury_funding (tx_hash, block_number, funded_at, usdg_spent, virtual_bought)
VALUES ('0x20a4f61d8e61b3c9568ff1674e9dc720e78e6482a246a3767d17f313d815aa3b', 10808814, 1784160017, 500.0, 813.152452124462797656);

INSERT OR IGNORE INTO buybacks (tx_hash, block_number, bought_at, monvera_amount, usdg_spent, virtual_spent, price_usd)
VALUES ('0x507b3c7fc82c250e601762ff596f0f1c214abddc4d38f00c2c378a45b05434bc', 10811286, 1784160264, 644535.886285976739600301, 0, 812.163330780000023879, 0);
