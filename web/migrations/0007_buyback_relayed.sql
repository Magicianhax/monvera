-- Relayed buybacks: the third buyback (2026-07-16, ~$112) executed as a RELAY
-- flow — USDG left the treasury in one tx, and the MONVERA fill arrived in a
-- separate tx sent by the relay. Neither tx alone matched the classifier, so it
-- was never indexed. Track the paired USDG-outflow tx per buyback so a relayed
-- fill can be priced by its own funding tx (and that outflow is never counted
-- twice). Applied with: npx wrangler d1 migrations apply monvera [--remote]

ALTER TABLE buybacks ADD COLUMN source_tx TEXT;

-- Backfill buyback #3 (decoded from the receipts):
--   outflow 0xc911558c… : 112 USDG -> relay                      (block 11196841)
--   fill    0x34f44872… : 160,065.717912 MONVERA -> treasury     (block 11196864)
-- => $112 spent, ~$0.00069971 per MONVERA.
INSERT OR IGNORE INTO buybacks (tx_hash, block_number, bought_at, monvera_amount, usdg_spent, virtual_spent, price_usd, source_tx)
VALUES ('0x34f448725d6648d82b1b4bc9d7bd7b6b4754a094bc56576a4f5d4e2b9af40652', 11196864, 1784198886, 160065.717912, 112.0, 0, 0.000699713, '0xc911558c8590010bd97bba93f2831799dd2189de51ce0c500fa516d0c8fc004f');
