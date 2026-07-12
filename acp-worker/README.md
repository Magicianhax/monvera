# Monvera ACP seller worker

Fulfils paid `buildPortfolioPlan` jobs on the Virtuals Agent Commerce Protocol
(v2 SDK). A thin bridge: validates the buyer's goal, sets the budget from the
registry listing, calls Vera's plan endpoint at monvera.best on funding, and
delivers the JSON plan. Holds no user funds and takes no custody: the job is
plan-only by design.

## Setup

1. **Generate a signer** on the agent wallet page (app.virtuals.io > your
   agent > Signers > **Add Signer**):
   - policy: **Virtuals-only**
   - copy the PRIVATE KEY from the dialog before closing (base64, `MIGH...`)
   - click Add Key & Complete
2. Fill `.env` (see `.env.example`):
   - `SELLER_WALLET_ADDRESS` — the agent wallet EVM address (top of the page)
   - `SELLER_WALLET_ID` — the "EVM WALLET ID" field on the wallet page
   - `SELLER_SIGNER_PRIVATE_KEY` — the key from step 1
   - `ACP_PLAN_KEY` — shared key; the same value goes into the web app via
     `npx wrangler secret put ACP_PLAN_KEY` (in `stax/web`)
3. **Save the job listing** in the dashboard (`buildPortfolioPlan`) — the
   worker reads the price and SLA from the registry, never hardcoded.
4. `npm install` then `node index.mjs`.

## Job contract

Requirement (what buyers send):

```json
{ "goal": "grow $300, mostly big tech, keep some safe", "budgetUsd": 300, "riskTolerance": "balanced" }
```

`goal` is required (plain words, 4-600 chars); the rest is optional. Loose
text instead of JSON also works: it is treated as the goal.

Deliverable: the full plan JSON — `allocations` (`{ symbol, weightPct, reason }`),
`riskScore`, a walk-forward `backtest` vs SPY (or null on a data gap), `model`,
`asOf`, and the standing disclaimer (a plan, not advice; nothing is bought or
sold).

## Lifecycle (v2 session state machine)

```
requirement message -> validate goal + offering -> session.setBudget(registry price)
job.funded          -> POST /api/agent/plan     -> session.submit(plan JSON)
job.completed       -> done
any failure         -> session.sendMessage(detail) + session.reject(tag)
```

Failed paid jobs are rejected WITH a reason so the buyer's escrow resolves
instead of timing out.

## Notes

- The signer key only authorizes Virtuals wallet operations (Virtuals-only
  policy); earnings settle to the agent smart wallet, which has no key on disk.
- Prices are snapshotted at startup: restart the worker after changing the
  listing price in the dashboard.
- Hosting: any always-on Node 20+ box. Run locally for sandbox testing; move
  to a small Railway/VPS service for production uptime.
