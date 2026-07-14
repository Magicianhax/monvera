// $MONVERA token content — the six tabs on the TokenScreen. Adapted from the
// Virtuals profile kit (tasks/virtuals-profile/, local-only) so the app and the
// Virtuals page tell the same story. Brand voice: honest, no hype, no AI slop.
// $MONVERA is the project token, not the product — never framed as an
// investment. Keep in sync when the profile kit changes.
export interface TokenTab {
  id: string;
  label: string;
  paragraphs: string[];
  bullets?: string[];
}

export const TOKEN_TABS: TokenTab[] = [
  {
    id: "about",
    label: "About",
    paragraphs: [
      "Monvera is an AI broker for real tokenized stocks. You tell Vera — our AI agent — a goal in plain words (“grow $300, mostly big tech, keep some safe”) and she builds a named basket of real companies, sized from live market data, each holding with a reason. One tap invests it. From $1, gasless, no seed phrase, email login.",
      "Vera is not a chatbot bolted onto a trading UI. She is registered on-chain agent #1 on Robinhood Chain, and every plan she builds carries her signed risk assessment — recorded on-chain by a verifier contract before any money moves. Her track record is public and re-checkable by anyone, without trusting our UI.",
      "$MONVERA is the community's stake in Vera, launched on Virtuals Protocol on Robinhood Chain — the same chain the app settles on. It is the project token, not the product: holding it is a choice, never a toll, and the app never requires it.",
      "Official links only — beware of fakes. App: monvera.best/app. Live demo (no account, no money): monvera.best/demo. Docs: docs.monvera.best. Vera's agent page: monvera.best/agent. X: x.com/monvera_best. The only $MONVERA contract is 0x7541872e32Bb529d7FF11D6C59832269ce33a6FF on Robinhood Chain; buy on Virtuals at app.virtuals.io/virtuals/105667.",
      "Monvera is not available in the US, Canada, the UK, or Switzerland. Nothing we publish is investment advice — stocks can go down as well as up, and backtests are history, not promises.",
    ],
  },
  {
    id: "how",
    label: "How it works",
    paragraphs: [
      "Say it. You type a goal the way you'd say it to a person: an amount, a tilt, a risk feel. No forms, no tickers, no finance-speak.",
      "Vera builds it. She turns the sentence into a diversified basket of real tokenized stocks — each holding sized from a year of live market data (returns, volatility, drawdown) and explained in one honest line. You can make it safer, bolder, or simpler before committing.",
      "Vera signs it. Before any money moves, Vera signs an EIP-712 risk assessment for the exact plan. An on-chain verifier contract checks that signature and records the plan — provable, not just promised. Anyone can re-verify it later from the public record.",
      "One tap invests it. Each holding is bought at a firm live quote through Arcus, the spot venue on Robinhood Chain. Gas is sponsored, so the user never pays network fees. Buys settle to the user's own smart account: self-custody, exportable key, and Monvera cannot move funds.",
      "She keeps working. Autopilot invests on a schedule inside four user-set limits you can revoke any time, price alerts watch the market, and a portfolio review reads concentration and overlap on demand.",
      "The trust loop, end to end: plain words to signed risk inference to on-chain verification to live-quote execution to a public, re-checkable record. Vera is ERC-8004 registered (agent #1 on Robinhood Chain) with a machine-readable agent card, so other agents can find and verify her too.",
      "Monvera charges no platform fee — revenue is a small venue referral on routed volume, so the app stays free for users.",
    ],
  },
  {
    id: "utility",
    label: "Utility",
    paragraphs: [
      "Hold 100,000 $MONVERA (about $100 at launch) to unlock Scan to Buy: photograph any product and Vera maps it to the listed companies behind it, then builds and invests a basket — on-chain, in one tap. It is the first live holder feature, and the concrete thing the gate opens.",
      "$MONVERA is the token behind Vera, launched through Virtuals Protocol on the same chain the product settles on. The app is the growth engine; the token is where the value lands. A broker you must pay a toll to trust is a worse broker, so the base app stays free — adoption drives volume, volume drives revenue, and revenue is what powers the token. Gating the basics would starve that flywheel.",
    ],
    bullets: [
      "Buybacks, funded by real revenue: Monvera earns a venue referral on every dollar Vera routes, and that revenue buys back $MONVERA. More users, more volume, more buy pressure.",
      "Pay with $MONVERA to hire Vera: she already sells portfolio construction to other agents on Virtuals ACP, and hiring her — as a person or an agent — becomes payable in $MONVERA at a discount over any other asset.",
      "Early access to everything new: Ask Vera, the daily brief, and public proof pages before public release.",
      "Holder-only theme baskets and strategies ahead of everyone else.",
      "Higher Autopilot limits and priority execution.",
      "A vote on which stocks, themes, and strategies Vera adds next.",
    ],
  },
  {
    id: "tokenomics",
    label: "Tokenomics",
    paragraphs: [
      "The numbers are set by the Virtuals launch mechanics and cannot be edited after launch. Supply is fixed — no mint function, no inflation.",
    ],
    bullets: [
      "Total supply: 1,000,000,000 $MONVERA, fixed.",
      "Liquidity Pool — 23%: fixed supply, locked in the trading pool.",
      "Team Initial Buy, Pledger allocation — 69.3%: 100% released at launch (13 Jul 2026).",
      "Team Initial Buy, Developer vesting — 7.7%: linear over 6 months, 09 Jan 2027 to 08 Jun 2027.",
      "The developer allocation is the only vesting tranche; it starts unlocking about six months post-launch and completes by 08 Jun 2027.",
    ],
  },
  {
    id: "roadmap",
    label: "Roadmap",
    paragraphs: [
      "We keep one public roadmap at monvera.best/roadmap and hold ourselves to its language: live means working now, building means in progress, exploring means we believe in it but won't promise a date.",
      "Live today (18 shipped): plans from plain words, one-tap invest and one-tap sell-all; a signed, on-chain record for every plan; Autopilot with user-set, revocable limits; a live screener across all 95 assets, Discover by theme, watchlist, and price alerts; theme baskets with open weights and walk-forward backtests anyone can pull as JSON; portfolio review, “explain my risk” in dollars, and a self-custody proof panel; Vera's public agent page and ERC-8004 agent card; full documentation at docs.monvera.best.",
      "Building now: Ask Vera anything — grounded answers about your holdings, only from data she can show; public proof pages where anyone re-checks a plan's signature on-chain; goal progress tracking; push alerts when the app is closed; and Vera's daily brief.",
      "Exploring: an open strategy engine, with machine-readable strategies published alongside their backtests; agent-callable allocation, where other agents pay Vera for a plan (live on Virtuals ACP as a first step), making Monvera infrastructure and not only an app; and wider access to more markets and asset types as they become quotable on-chain.",
      "$MONVERA holders back this whole arc: as Vera's capabilities and usage grow, so does the agent the token stakes.",
    ],
  },
  {
    id: "qa",
    label: "Q&A",
    paragraphs: [
      "Q: What value does the token capture?",
      "A: The token captures Vera's growth, and we're wiring that in deliberately rather than bolting it on after.",
      "Q: How do buybacks work?",
      "A: Monvera earns revenue on every dollar Vera routes, and that revenue buys back $MONVERA. More volume, more buy pressure — a simple flywheel.",
      "Q: Can I pay with $MONVERA?",
      "A: Vera already sells portfolio construction to other agents on Virtuals ACP. Hiring her — whether you're a person or an agent — will be payable in $MONVERA, at a discount over anything else.",
      "Q: What do holders get?",
      "A: The premium layer of the app — early access to everything new (Ask Vera, the daily brief, proof pages), holder-only theme baskets and strategies before public release, higher Autopilot limits and priority execution, and a vote on which stocks, themes, and strategies Vera adds next.",
      "Q: Why keep the app free?",
      "A: The free app is the growth engine, not a giveaway. It drives volume, volume drives revenue, and revenue drives buybacks. The token sits where the value lands.",
      "Q: What's the supply picture?",
      "A: 1B fixed supply, no mint, LP locked, developer allocation vesting. Vera is the agent economy's first real broker, and the token is the early way in — not an investment product, and never required to use the app.",
    ],
  },
];
