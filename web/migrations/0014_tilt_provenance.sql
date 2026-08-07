-- Persist the TILT that set this window's target, alongside the verdict that
-- decided its timing.
--
-- The tilt is the decision that actually moves the goalposts: Vera scales each
-- published weight by 0.7-1.3x, and the plan then trades toward THAT, not the
-- published composition. Until now `TiltResult` carried reason/source/lintOk and
-- only .weights and .source were ever read again — the rationale for the window's
-- active target was discarded the instant it was computed, so "why is NVDA at
-- 16.3% against a 14% published weight?" was unanswerable after the fact. For a
-- product whose selling point is an accountable agent with a public track record,
-- that is the one decision that most needs a receipt.
--
-- It is also what lets user-facing copy stop lying. Notifications and the panel
-- both asserted "realigned toward its published weights" unconditionally, which
-- is false whenever source = 'model'. A sentence may only name a basis that is a
-- stored field on the row it describes; this migration makes that field exist.
--
-- Nullable on purpose: every row written before this migration has no tilt
-- recorded, and NULL must read as "unknown", never as "base". Copy branches on
-- source = 'base' explicitly, so an unknown tilt degrades to the neutral wording
-- rather than to a claim we cannot support.
--
-- Apply BEFORE the deploy that writes here:
--   npx wrangler d1 migrations apply monvera --remote

ALTER TABLE rebalance_outcomes ADD COLUMN tilt_source TEXT;    -- 'model' | 'base' | NULL (pre-migration)
ALTER TABLE rebalance_outcomes ADD COLUMN tilt_reason TEXT;    -- Vera's one line on why she tilted
ALTER TABLE rebalance_outcomes ADD COLUMN tilt_lint_ok INTEGER; -- 1/0/NULL, same meaning as lint_ok
