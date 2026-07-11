# Monvera ACP seller worker

Fulfils paid `buildPortfolioPlan` jobs on the Virtuals Agent Commerce Protocol.
A thin bridge: accepts jobs, calls Vera's plan endpoint at monvera.best, and
delivers the JSON plan. Holds no user funds and takes no custody: the job is
plan-only by design.

## Setup

1. **Whitelist a dev wallet** in the ACP dashboard (app.virtuals.io/acp, your
   agent > session keys). Note the session entity id.
2. **Generate the shared plan key** (any long random string) and set it twice:
   - web app: `npx wrangler secret put ACP_PLAN_KEY` (in `stax/web`)
   - worker: `ACP_PLAN_KEY` in `.env` here
3. `cp .env.example .env` and fill the rest (agent wallet from the dashboard).
4. `npm install` then `node index.mjs`.

The worker logs one line per job phase. Test the loop in the ACP sandbox with
a buyer agent before pushing for graduation.

## Job contract

Requirement (what buyers send):

```json
{ "goal": "grow $300, mostly big tech, keep some safe", "budgetUsd": 300, "riskTolerance": "balanced" }
```

`goal` is required (plain words, 4-600 chars); the rest is optional. Loose
text instead of JSON also works: it is treated as the goal.

Deliverable (what Vera returns): the full plan object — `allocations`
(`{ symbol, weightPct, reason }`, integer weights summing to 100), `riskScore`,
a walk-forward `backtest` vs SPY (or null on a data gap), `model`, `asOf`, and
the standing disclaimer (a plan, not advice; nothing is bought or sold).

## Notes

- Failed paid jobs are rejected WITH a reason so the buyer's escrow resolves
  instead of timing out.
- Hosting: any always-on Node 20+ box. Run it locally for sandbox testing;
  move to a small Railway/VPS service for production uptime.
