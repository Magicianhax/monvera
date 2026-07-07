// Shared FAQ content — the single source of truth for both the marketing
// landing (`SiteLanding` accordion) and the in-app Help screen (`HelpScreen`).
// Keep answers plain-spoken and honest: this is the same voice Vera uses.
// House style: no em dashes; use commas, periods, or parentheses.

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: "What exactly am I buying?",
    a: "A tokenized stock that tracks the real share price one to one. When you buy Apple, you hold a token that moves with Apple's actual stock. It settles on Robinhood Chain and lives in a wallet only you control, so your holding is provable on-chain, not promised in fine print.",
  },
  {
    q: "Who is Vera, and do I stay in control?",
    a: "Vera is your AI broker. Tell her a goal in a sentence and she builds a diversified plan, sizes each position from real market data, and explains every pick in plain words. Nothing moves until you read it and tap to confirm. You approve every plan.",
  },
  {
    q: "How do I know Vera's plans actually work?",
    a: "Every plan is backtested against 12 months of real market history before you invest, and shown next to the S&P 500 so you can compare. We also publish our own rule-based strategies in the open, with honest walk-forward backtests, at monvera.best/strategies. Past results never promise the future, but nothing here is a black box.",
  },
  {
    q: "What does it cost?",
    a: "Monvera covers the network (gas) fees, so you never pay gas, and there are no account fees or subscriptions. We earn a small referral from Arcus, the venue that prices our trades, on the volume we route, so the app stays free for you. No hidden platform fee on top.",
  },
  {
    q: "How much do I need to start?",
    a: "One dollar. No minimum balance, no paperwork, no waiting list, just a goal and a tap.",
  },
  {
    q: "What is USDG?",
    a: "USDG (Global Dollar) is your spendable cash in the app, a digital dollar that always aims to be worth $1. You add it, invest it, or send it, and you cash out back to it when you sell.",
  },
  {
    q: "Where does my money actually live?",
    a: "In a wallet only you control. Monvera never holds your funds. Everything settles on Robinhood Chain, a fast, low-cost Ethereum L2, and every move leaves a public receipt you can check yourself.",
  },
  {
    q: "How does Monvera get me a fair price?",
    a: "Every buy and sell is priced and routed through Arcus, an on-chain trading venue on Robinhood Chain. You always get a live market quote, and because the quote and the trade settle on-chain together, the price is provable, not taken on trust. Monvera covers the gas and earns only a small referral from Arcus on the volume it routes.",
  },
  {
    q: "Can I sell or cash out anytime?",
    a: "Anytime. Sell your holdings back to USDG on the spot, with no lock-ups, no waiting periods, and no penalties.",
  },
  {
    q: "What can I invest in?",
    a: "Names you already know like Apple, Nvidia, and Tesla, broad funds like the S&P 500 (SPY) and Nasdaq 100 (QQQ), sector and commodity ETFs, and short-term US Treasuries (SGOV) for the steadier side of a plan. Close to 100 tokenized stocks and funds in all.",
  },
  {
    q: "Is every trade really recorded on-chain?",
    a: "Yes. Vera signs each recommendation with a cryptographic signature, and it is verified and recorded on Robinhood Chain in the same transaction as your trades. Your track record cannot be edited after the fact, and the Activity screen links every buy, sell, and transfer to its on-chain receipt.",
  },
  {
    q: "Who is behind Vera?",
    a: "Vera runs on Virtuals, the agent network that gives her a verifiable on-chain identity (a registered agent ID anyone can look up) and powers the AI that builds your plans. Because her identity and every signed recommendation are recorded on-chain, her track record is public and cannot be quietly rewritten later.",
  },
  {
    q: "Where is Monvera available?",
    a: "Most of the world. It is not available in the United States, Canada, the United Kingdom, or Switzerland. Tokenized stocks carry risk and this is not investment advice, so only invest what you can leave for a while.",
  },
  {
    q: "How do I get help?",
    a: "Email us at monvera.best@gmail.com and a human will get back to you. You can also ask Vera anything in plain words inside the app, she is built to explain.",
  },
];
