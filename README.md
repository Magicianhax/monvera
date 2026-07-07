<div align="center">

<img src="web/public/brand/monvera-icon.png" alt="Monvera" width="88" />

# Monvera

**Own real companies. Just say what you want.**

Monvera is an AI broker for real tokenized stocks on **Robinhood Chain**. Tell **Vera**,
your AI agent, a goal in plain words. She builds a diversified portfolio of real companies,
signs it on-chain, and invests it in one tap: gasless, non-custodial, from $1.

### [Live at monvera.best](https://monvera.best)

</div>

---

## Why it is different: accountable AI

Most "AI trading" products ask you to trust a black box. Monvera makes the AI accountable:

- **Verifiable identity.** Vera is a registered on-chain agent (ERC-8004 IdentityRegistry,
  agent #1 on Robinhood Chain). Anyone can look her up.
- **Signed recommendations.** Every plan Vera builds is signed (EIP-712) and the signature is
  verified and recorded **on-chain in the same transaction as the trades**. Her track record
  cannot be edited after the fact.
- **Open strategies.** Monvera publishes its own rule-based strategies with honest,
  walk-forward backtests at [`/strategies`](https://monvera.best/strategies), raw JSON at
  [`/api/strategies`](https://monvera.best/api/strategies). No look-ahead, no cherry-picking.
- **Honest UI.** Plans ship with a plain-language risk read, backtests are labeled
  "history, not a promise", and the app never shows a number it cannot back on-chain.

## What you can do

| | |
|---|---|
| **Say a goal, get a plan** | "Grow $300, mostly big tech, keep some safe" becomes a named basket with a one-line reason per holding, sized from live market data and backtested against the S&P 500. |
| **Invest in one tap** | Every leg is a firm Arcus RFQ quote, settled as one sponsored transaction. No gas, no seed phrase, no tickers required. |
| **Trade ~100 real stocks and funds** | Apple, Nvidia, the S&P 500, US Treasuries and more, tokenized 1:1, with live prices, charts, watchlist, and daily movers. |
| **Autopilot** | Delegate once (Privy session signer) and Vera invests on a schedule within hard bounds you set: amount, cadence, and a risk ceiling she cannot cross. |
| **Stay in control** | Non-custodial smart account. Sell back to USDG any time. Every buy, sell, and send links to its on-chain receipt. |

## How it works

```
you ──goal──▶ Vera (Virtuals inference)
                 │  builds + sizes the basket, EIP-712-signs the risk assessment
                 ▼
        POST /api/allocate ──▶ plan + backtest shown to you
                 │  one tap
                 ▼
   ERC-4337 smart account (Pimlico, gas sponsored)
     ├─ verify Vera's signature + record the plan   (on-chain, same tx)
     └─ execute each leg via Arcus spot RFQ         (Permit2, USDG settlement)
```

- **Chain**: Robinhood Chain mainnet (id 4663), an Arbitrum-stack Ethereum L2.
  Explorer: [Blockscout](https://robinhoodchain.blockscout.com).
- **Venue**: [Arcus](https://arcus.xyz) spot RFQ for firm quotes on tokenized equities.
- **Agent runtime**: [Virtuals](https://virtuals.io) for Vera's inference and on-chain identity.
- **Wallets**: [Privy](https://privy.io) embedded wallets (email/social login), owner of a
  SimpleAccount v0.7 smart account relayed by [Pimlico](https://pimlico.io).
- **Market data**: real equity history for charts and backtests, plus Chainlink feeds
  on-chain where available.

## Deployed contracts (Robinhood Chain, id 4663)

| Contract | Address | Role |
|---|---|---|
| Executor + InferenceVerifier | [`0x7ff1a5ee19330c165146488a7ad8af6cb41da1df`](https://robinhoodchain.blockscout.com/address/0x7ff1a5ee19330c165146488a7ad8af6cb41da1df) | Verifies Vera's EIP-712 risk signature and records every plan, batched with the trades. |
| IdentityRegistry (ERC-8004) | [`0x751ae640cfa816404b017fbb8234dd21abafbbdc`](https://robinhoodchain.blockscout.com/address/0x751ae640cfa816404b017fbb8234dd21abafbbdc) | Vera's verifiable agent identity (agent #1). |

Solidity sources live in [`contracts/`](contracts/).

## Repo layout

```
web/         Next.js app (App Router, PWA): the product, marketing site, and API
  src/app/api/        allocate, quote, market, portfolio, autopilot, strategies, ...
  src/lib/server/     Vera's inference, Arcus RFQ, quant/backtest engine, market data
  src/components/     app screens (lite/), marketing site (site/), design system (design/)
contracts/   Hardhat project: executor/verifier, ERC-8004 identity registry
docs/        prompts and working docs
```

## Run it locally

```bash
cd web
npm install
cp .env.example .env.local   # fill in the keys you have (see comments per variable)
npm run dev                  # http://localhost:3000
```

The app degrades gracefully: with no keys you still get the marketing site, live market
data, and the demo. Trading needs Privy + Pimlico keys; Vera's plans need a Virtuals
(or Anthropic) key.

## Deploy (Cloudflare)

The whole product runs on Cloudflare: the Next.js app via
[OpenNext](https://opennext.js.org/cloudflare) on Workers, static assets on the CDN.

```bash
cd web
npm run preview   # build + run locally on the workerd runtime
npm run deploy    # build + deploy to Cloudflare
```

Config lives in `web/wrangler.jsonc` and `web/open-next.config.ts`.

## Honesty notes

- Tokenized stocks carry risk. Prices can go down. Nothing here is investment advice.
- Monvera is not available in the United States, Canada, the United Kingdom, or Switzerland.
- Backtests are history, not promises, and the app says so wherever they appear.

---

Built by the Monvera team. Say hi: [@monvera_best](https://x.com/monvera_best).
