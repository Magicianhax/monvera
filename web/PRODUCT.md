# Product

## Register

product

## Users

People who have never invested and find both brokerages and crypto intimidating. The guiding persona is comfortable with a banking or payments app (Cash App, Monzo) but has never bought a stock and doesn't know what a "ticker" or a "wallet" is. Mobile-first, often in places where opening a US brokerage account is hard but a phone is universal. A secondary audience of confident users wants hands-on control (live prices, manual buy/sell, plan tweaking, the agent's track record) without that depth bleeding into the beginner path.

The job to be done: "Tell an assistant what I want with my money, and have it invest for me, safely, in one tap — and trust that it's real."

## Product Purpose

Monvera is an AI broker for real tokenized stocks and funds (Apple, Tesla, Nvidia, the S&P 500, US Treasuries). A person types a goal in plain words and an amount; the agent (Vera) builds a named basket with a one-line reason per holding and a plain-language risk read; one tap invests. It runs gasless and non-custodial on Robinhood Chain, but the user never sees a wallet, a gas fee, a hex address, or the word "swap." Success: a complete newcomer goes from "I've never invested" to "I own a piece of Apple" in about two minutes, feeling calm and in control the whole way.

## Brand Personality

Warm, encouraging, honest. A smart friend who happens to be great at money, not a trading terminal and not a hype machine. Three words: **calm, trustworthy, capable.** The interface should feel like it quietly did the hard part for you. Confidence comes from clarity and restraint, not from charts, tickers, or urgency. Delight is reserved for moments (the plan landing, the invest succeeding, Vera "thinking"), never sprayed across every screen.

## Anti-references

- **Trading terminals** (Bloomberg, MetaTrader, thinkorswim): dense tickers, red/green walls, candlesticks, numbers shouting. Monvera is precise without shouting.
- **Crypto dashboards / wallets** (typical DeFi UIs): hex addresses as first-class content, "gas," "approve," "sign," network pickers, token logos over company logos. None of this may surface to the user.
- **Hype / meme-coin apps**: neon gradients, rocket emoji, "to the moon," fake urgency, gamified gambling cues. Monvera is honest about risk, never a casino.
- Generic AI-slop: gradient text, glassmorphism-by-default, an uppercase tracked eyebrow above every section, identical icon-heading-text card grids.

## Design Principles

1. **Translate, never expose.** Every crypto/finance term is rendered in human language at the boundary: wallet → account, gas/fee → free, token → the company's real name and logo, swap → buy, transaction → secured. The blockchain is the engine, never the dashboard.
2. **One obvious action per screen.** A first-timer should never hunt for what to do next. The primary action is the largest, warmest, most obvious thing; everything else recedes.
3. **Honesty is the trust mechanic.** Tell the truth about risk in plain words ("stocks can go down too," "this rate can change"). Never imply guaranteed gains. Truth is what makes a nervous beginner trust us.
4. **Accountable AI, quietly surfaced.** Vera has a verifiable on-chain identity and a recorded track record. Convey "this advice is accountable and permanent" as a small, tasteful trust signal, never as noise.
5. **Calm craft, delight in moments.** Restraint is the default register (consistent components, generous spacing, quiet color). Spend motion and personality on the few emotional beats that matter, and nowhere else.

## Accessibility & Inclusion

- WCAG AA contrast on all text (body ≥ 4.5:1, large/bold ≥ 3:1); muted ink must still clear the bar against tinted surfaces. Beginner-safe means readable.
- Full `prefers-reduced-motion` alternatives for every animation (crossfade or instant; entrances must never gate content visibility).
- Mobile-first with large, forgiving tap targets; the whole product is phone-sized even on desktop (centered device frame).
- Forgiving, plain-language error handling — never punish a first-timer for not knowing finance terms. Light + dark themes both first-class.
