-- Complete the buyback backfill. 0005 recorded only the two txs first surfaced
-- (funding 0x20a4 + buyback 0x507b), but the treasury actually ran TWO full
-- USDG->VIRTUAL->MONVERA cycles on 2026-07-16 (four legs, treasury nonce 8),
-- holding 1,302,111.20 MONVERA. The two-leg indexer fix (buybackStore.ts) now
-- auto-indexes future buybacks; this migration adds the two legs that landed
-- before that fix so the dashboard reconciles to the on-chain balance.
--   funding2 0x17f5… : 500 USDG -> 812.163331 VIRTUAL            (block 10810668)
--   buyback1 0x07c7… : 813.152452 VIRTUAL -> 657,575.313354 MONVERA (block 10810283)
-- Four legs together: $1,000 spent, 1,302,111.20 MONVERA, ~$0.000768 avg.
-- Applied with: npx wrangler d1 migrations apply monvera [--remote]

INSERT OR IGNORE INTO treasury_funding (tx_hash, block_number, funded_at, usdg_spent, virtual_bought)
VALUES ('0x17f5bea26c3b7979387ed60024d79413247db87d86c61d3b4dda6cfbf3dfd0e2', 10810668, 1784160203, 500.0, 812.1633307827121);

INSERT OR IGNORE INTO buybacks (tx_hash, block_number, bought_at, monvera_amount, usdg_spent, virtual_spent, price_usd)
VALUES ('0x07c7d2e1e271c4ed6a261cc11f096c2a12d329ded778a3898d6935c66d8733ef', 10810283, 1784160164, 657575.3133537355, 0, 813.1524521199999, 0);
