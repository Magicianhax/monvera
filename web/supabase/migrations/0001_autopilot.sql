-- Stax Autopilot — durable store, audit log, atomic claim, and scheduler.
-- Run in the Supabase SQL editor (Dashboard → SQL) or via `supabase db push`.
-- Safe to re-run (idempotent).

-- 1) Tables -----------------------------------------------------------------
create table if not exists public.autopilots (
  user_id            text primary key,        -- Privy user id (one autopilot per user)
  id                 text not null,
  wallet_id          text not null,           -- Privy embedded-wallet id (server signs for this)
  owner              text not null,           -- embedded EOA (smart-account owner)
  smart_account      text not null,           -- the AA address that holds funds + executes
  goal               text not null,
  amount_usd         numeric not null,
  cadence            text not null check (cadence in ('daily','weekly','biweekly','monthly')),
  risk_ceiling_bps   integer not null,
  max_per_period_usd numeric not null,
  active             boolean not null default true,
  created_at         bigint  not null,        -- unix seconds
  next_run_at        bigint  not null,        -- unix seconds
  last_run_at        bigint,
  runs               integer not null default 0,
  spent_this_period  numeric not null default 0
);
create index if not exists autopilots_due_idx on public.autopilots (next_run_at) where active;

create table if not exists public.autopilot_runs (
  id                bigserial primary key,
  user_id           text not null,
  ran_at            bigint not null,           -- unix seconds
  amount_usd        numeric not null,
  assessed_risk_bps integer,
  status            text not null check (status in ('success','skipped','error')),
  reason            text,
  tx_hash           text,
  holdings          jsonb,                     -- what the run bought: [{symbol,weightPct,amountUsd}]
  created_at        timestamptz not null default now()
);
create index if not exists autopilot_runs_user_idx on public.autopilot_runs (user_id, ran_at desc);

-- 2) RLS — lock both tables. Only the service-role key (server) touches them;
--    with no anon/authenticated policies, the Data API cannot read or write them.
alter table public.autopilots     enable row level security;
alter table public.autopilot_runs enable row level security;

-- 3) Atomic claim — advances next_run_at and resets the period spend AS IT READS,
--    so two overlapping cron runs can never execute the same autopilot twice.
--    SECURITY INVOKER (default): only the service role (which bypasses RLS) can
--    run it meaningfully; execute is revoked from the Data API roles below.
create or replace function public.claim_due_autopilots(now_seconds bigint)
returns setof public.autopilots
language sql
set search_path = ''
as $$
  update public.autopilots a
  set next_run_at = a.next_run_at + case a.cadence
        when 'daily'    then 86400
        when 'weekly'   then 604800
        when 'biweekly' then 1209600
        else                 2592000   -- monthly
      end,
      spent_this_period = 0
  where a.active and a.next_run_at <= now_seconds
  returning a.*;
$$;
-- Lock execution to the server (service_role); remove the default PUBLIC grant
-- so anon/authenticated (Data API) can't call it.
revoke all on function public.claim_due_autopilots(bigint) from public;
grant execute on function public.claim_due_autopilots(bigint) to service_role;

-- 4) Scheduler — Supabase pg_cron fires the app's cron endpoint hourly via pg_net.
--    EDIT the two placeholders, then run this block:
--      <APP_URL>  = your CANONICAL deployed origin, no trailing slash.
--                  IMPORTANT: use the domain that does NOT redirect. pg_net does not
--                  follow redirects, so an apex->www (or www->apex) 308/301 makes the
--                  call land on the redirect and never reach the app (you'll see 401).
--                  e.g. https://monvera.xyz (your canonical, non-redirecting origin)
--      <SECRET>   = the value of AUTOPILOT_CRON_SECRET in your app env
--    Tip: keep <SECRET> out of the job definition by storing it in Supabase Vault and
--    reading it inline, e.g.:
--      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                    where name = 'autopilot_cron_secret')
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('stax-autopilot') where exists (select 1 from cron.job where jobname = 'stax-autopilot');
select cron.schedule(
  'stax-autopilot',
  '0 * * * *',           -- hourly; due autopilots run on their own cadence
  $$
    select net.http_get(
      url     := '<APP_URL>/api/cron/autopilot',
      headers := jsonb_build_object('Authorization', 'Bearer <SECRET>')
    );
  $$
);
