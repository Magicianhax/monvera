// The roadmap, in one place. The landing preview (#roadmap) and the full
// /roadmap page both read this, so they can never drift apart.
//
// When something ships, move it into `live`. That is the whole maintenance
// story: the counts, the rail, and the preview all follow.

export type Phase = "live" | "building" | "exploring";

export interface RoadmapItem {
  name: string;
  note: string;
}

export interface RoadmapPhase {
  phase: Phase;
  /** Rail heading. */
  title: string;
  /** One honest sentence about the certainty of this band. */
  lede: string;
  items: RoadmapItem[];
}

export const ROADMAP: RoadmapPhase[] = [
  {
    phase: "live",
    title: "Live today",
    lede: "Working right now. Most of it you can try in the demo, with no account and no money.",
    items: [
      { name: "Plans from plain words", note: "Tell Vera a goal and an amount. She returns a named basket of real companies, each with a reason." },
      { name: "One-tap invest", note: "Every holding is priced at a live quote and bought in a single transaction. The network cost is on us." },
      { name: "A signed, on-chain record", note: "Vera signs the risk assessment behind each plan, recorded in the same transaction that buys the stocks." },
      { name: "Autopilot", note: "Invest a set amount on a schedule, inside four limits you set and can switch off at any time." },
      { name: "Live Screener", note: "All 95 companies and funds ranked by a year of real returns, momentum, volatility, and drawdown." },
      { name: "Discover", note: "Browse the market by theme instead of hunting for tickers." },
      { name: "Watchlist", note: "Star any company and keep its price and chart one tap away." },
      { name: "Price alerts", note: "Tell Monvera a price and it tells you when a company reaches it." },
      { name: "Notification center", note: "An inbox for your buys, sells, alerts, and Autopilot runs, with an unread badge." },
      { name: "Today's movers", note: "The day's gainers and losers, with an honest line on what actually moved." },
      { name: "Since you bought", note: "How the market has moved since you entered, stated plainly." },
      { name: "Explain my risk", note: "What a rough week could cost your plan, in dollars, before you commit." },
      { name: "Self-custody proof", note: "A live on-chain panel showing the account is yours and Monvera cannot move it." },
      { name: "Vera's public agent page", note: "Her verifiable on-chain identity and recorded track record, open to anyone." },
      { name: "Agent card", note: "A machine-readable ERC-8004 endpoint so other agents can find and verify Vera." },
      { name: "Documentation", note: "Plain-language guides and a full developer reference at docs.monvera.best." },
    ],
  },
  {
    phase: "building",
    title: "Building now",
    lede: "Actively in progress. These are the things people ask for, and the ones that make the agent easier to trust.",
    items: [
      { name: "Ask Vera anything", note: "A grounded conversation about your holdings and the market, answering only from data she can show you." },
      { name: "Public proof pages", note: "A shareable page for any plan, where anyone can re-check Vera's signature on-chain without an account." },
      { name: "Goal progress", note: "See how far a plan has carried you toward the goal you actually asked for." },
      { name: "Alerts when the app is closed", note: "The same notifications, delivered to your phone rather than waiting in the app." },
      { name: "Vera's daily brief", note: "A short, honest read on what moved and what it means for what you own." },
    ],
  },
  {
    phase: "exploring",
    title: "Exploring",
    lede: "Bigger and less certain. We think these matter. We do not know when, or in what shape, they land.",
    items: [
      { name: "An open strategy engine", note: "Theme pages and machine-readable strategies, published with their backtests, that anyone can inspect." },
      { name: "Agent-callable allocation", note: "Letting other agents ask Vera for a plan and pay for it, so Monvera becomes infrastructure and not only an app." },
      { name: "Wider access", note: "More markets and asset types, as they become real and quotable on-chain." },
    ],
  },
];

export const countOf = (phase: Phase): number =>
  ROADMAP.find((p) => p.phase === phase)?.items.length ?? 0;
