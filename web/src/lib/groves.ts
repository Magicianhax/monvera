// The Grove registry, in one place. The /groves list, each /groves/[id] page,
// the public API, and (once deployed) the GroveManager wiring all read this —
// so composition, fees, and copy can never drift apart.
//
// A Grove is a STRATEGY, not a fund: the basket is bought into the user's own
// wallet, non-custodial, $0 to enter and hold. The only fee is feeBps (10%) of
// PROFIT at exit, against the user's own cost basis. Every weight, exclusion,
// and rule below is public on purpose.
//
// Compositions are constrained to the contract-routable set (names a venue can
// actually fill on-chain today, probe 2026-07-19). Anything screened IN but not
// yet routable is listed in `excluded` with an honest note, never silently
// dropped.
import { assetBySymbol } from "./tokens";
import { capAllocationLegs } from "./arcusShared";

export interface GroveComponent {
  symbol: string;
  /** Target weight in basis points (all components sum to exactly 10000). */
  weightBps: number;
  /** One honest line on why this name is in the basket. */
  reason: string;
}

export interface GroveExclusion {
  symbol: string;
  why: string;
}

export interface GroveDef {
  id: string;
  /** Display ticker for the strategy (e.g. "$TAYYIB"). Not a token. */
  ticker: string;
  name: string;
  /** One line. */
  thesis: string;
  /** Two-three sentences for the detail page. */
  longThesis: string;
  category: string;
  components: GroveComponent[];
  /** Names screened out or not yet buyable, each with the real reason. */
  excluded?: GroveExclusion[];
  /** Short markdown: how the basket is screened, weighted, and rebalanced. */
  methodology: string;
  /** Exit fee on profit only, in basis points. 1000 = 10% of profit at exit. */
  feeBps: number;
  /** Smallest buy, USD. Small amounts CONCENTRATE into the largest holdings
   *  (groveLegsFor); every name is included from fullDiversificationUsd up. */
  minBuyUsd: number;
  /** Advisory sizing bar, USD — never blocking. Every swap pays the trading
   *  venue's spread/LP fees (priced into quotes); below ~$50 those costs take
   *  a visibly bigger share of the buy, so this is the recommended floor. */
  recommendedUsd: number;
  rebalancePolicy: string;
  /** Whether this grove is open for business. Kept as editorial intent only —
   *  the SOURCE OF TRUTH for "can I buy this" is `onChainId !== undefined`,
   *  because that is the contract's own answer. Never gate a buy on this. */
  launched: boolean;
  /** This grove's groveId in the GroveManager contract. Undefined = not created
   *  on-chain yet, so the page shows preview stats.
   *
   *  This is deliberately EXPLICIT rather than "index in GROVES". The array
   *  position looks like the groveId (createGrove assigns 0, 1, 2...) and it is
   *  wrong the moment on-chain and registry order diverge — which happened on
   *  2026-07-27, when grove 0 was created from a composition that matched no
   *  registry entry and the positional mapping silently pointed "tayyib" at it.
   *  Set it from what scripts/grove-create.js prints, and let
   *  scripts/grove-verify.js prove it still holds. */
  onChainId?: number;
  /** Optional raster cover art. Unset, every surface renders the grove's
   *  code-native SVG motif (components/GroveCover). To override: drop art into
   *  web/public/groves/<id>.jpg and set this to "/groves/<id>.jpg" — cards and
   *  detail bands switch to the image automatically, accent wash preserved. */
  coverImage?: string;
}

/** One advisory bar shared by every Grove: venue trading costs are roughly
 *  fixed per leg, so under ~$50 they take a visibly bigger share — $100+ is
 *  recommended. Advisory only; minBuyUsd stays the sole hard floor. */
export const RECOMMENDED_BUY_USD = 100;

export const GROVES: GroveDef[] = [
  {
    id: "tayyib",
    coverImage: "/groves/tayyib.webp",
    ticker: "$TAYYIB",
    name: "Tayyib Grove",
    thesis: "AAOIFI shariah-screened large caps — screened, not certified.",
    longThesis:
      "Every name passes the AAOIFI sector screen (no banks, insurance, gambling, alcohol, weapons, adult content) and the ratio screens on debt, interest-bearing assets, and impure income. We publish every exclusion and its reason, and the screen re-runs quarterly. Screened by us and shown openly — certification is in progress, and until it lands we will not use the word.",
    category: "Values",
    components: [
      { symbol: "NVDA", weightBps: 1700, reason: "Largest AI chip designer; passes the sector and ratio screens." },
      { symbol: "MSFT", weightBps: 1600, reason: "Cash-rich software platform with low debt relative to its size." },
      { symbol: "AAPL", weightBps: 1500, reason: "Hardware and services giant; debt ratio is borderline and re-checked quarterly." },
      { symbol: "GOOGL", weightBps: 1100, reason: "Search and cloud; small impure-income sliver flagged for purification." },
      { symbol: "AMZN", weightBps: 1000, reason: "Commerce and cloud; impure income stays under the 5% line." },
      { symbol: "META", weightBps: 800, reason: "Ad platform; clean on the ratio screens, impure sliver flagged." },
      { symbol: "TSM", weightBps: 600, reason: "The world's contract chip manufacturer, on a conservative balance sheet." },
      { symbol: "TSLA", weightBps: 500, reason: "Passes the screens; its volatility is priced into the small weight." },
      { symbol: "ASML", weightBps: 400, reason: "Sole supplier of EUV lithography; low-debt industrial." },
      { symbol: "AMD", weightBps: 300, reason: "Challenger chip designer; clean screens, smaller and swingier." },
      { symbol: "QCOM", weightBps: 300, reason: "Mobile silicon plus a licensing stream; passes the ratio screens." },
      { symbol: "AMAT", weightBps: 200, reason: "Chip-equipment maker; clean screens, cyclical, so sized last." },
    ],
    excluded: [
      { symbol: "AVGO", why: "Passes the screen but is not yet routable on-chain — added when a venue can fill it." },
      { symbol: "LLY", why: "Passes the screen but is not yet routable on-chain." },
      { symbol: "XOM", why: "Passes the screen but is not yet routable on-chain." },
      { symbol: "COIN", why: "Interest on customer cash is a material revenue line." },
      { symbol: "CRCL", why: "The core business is interest earned on reserves." },
      { symbol: "SGOV", why: "An interest-bearing instrument outright." },
      { symbol: "SPY", why: "Tracks an index that includes non-compliant names." },
      { symbol: "QQQ", why: "Tracks an index that includes non-compliant names." },
      { symbol: "MSTR", why: "Leverage-financed bitcoin holding company; fails the debt screen." },
      { symbol: "FUTU", why: "Brokerage with margin-lending revenue." },
      { symbol: "CCL", why: "Casino and alcohol revenue on board." },
      { symbol: "NFLX", why: "Fails the content screen." },
    ],
    methodology:
      "**Screen.** AAOIFI sector screen (no banks, insurance, gambling, alcohol, weapons, adult content), then ratio screens: interest-bearing debt under 33% of market cap, interest-bearing securities under 33%, impure income under 5%. Screened, not certified.\n\n" +
      "**Weighting.** Market-cap informed with a 20% single-name cap; excess redistributes down the list.\n\n" +
      "**Rebalancing.** None automatic today: your basket holds exactly what you bought until you change it. The screen re-runs quarterly, and when a screen drops a name we publish it here rather than moving your holdings for you. A per-holding impure-income estimate is published so holders can purify that sliver.",
    feeBps: 1000,
    // 12 names, smallest weight 2%: $100 is what it takes for every one of them
    // to clear the per-leg floor, so every depositor holds the same basket.
    minBuyUsd: 100,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "no automatic rebalancing yet — the basket holds exactly what you bought",
    launched: false,
  },
  {
    id: "titan",
    coverImage: "/groves/titan.webp",
    ticker: "$TITAN",
    name: "Titan Grove",
    thesis: "The seven US mega-cap platforms plus a Nasdaq-100 anchor.",
    longThesis:
      "The seven companies that dominate US market returns, held directly, with a Nasdaq-100 tracker as ballast. Nothing clever: the bet is simply that scale, cash flow, and AI spending stay concentrated where they already are. Built to trade as little as possible.",
    category: "Core",
    components: [
      { symbol: "QQQ", weightBps: 1600, reason: "The Nasdaq-100 anchor — one position that steadies the seven single names." },
      { symbol: "NVDA", weightBps: 1400, reason: "The AI chip supplier the other six all buy from." },
      { symbol: "MSFT", weightBps: 1300, reason: "Cloud and software; the steadiest earner of the seven." },
      { symbol: "AAPL", weightBps: 1300, reason: "The largest consumer hardware and services franchise." },
      { symbol: "GOOGL", weightBps: 1100, reason: "Search economics funding an AI and cloud arm." },
      { symbol: "AMZN", weightBps: 1100, reason: "Commerce plus AWS, the largest cloud." },
      { symbol: "META", weightBps: 1100, reason: "Billions of daily users monetized by ads." },
      { symbol: "TSLA", weightBps: 1100, reason: "The volatile one — EVs, energy, and robotics bets." },
    ],
    methodology:
      "**Selection.** The seven largest US technology platforms, each held directly, plus the Nasdaq-100 tracker as the largest single position.\n\n" +
      "**Weighting.** Near-equal across the seven; the index anchor sized above them so no single company decides the basket.\n\n" +
      "**Rebalancing.** None automatic today: your basket holds exactly what you bought until you change it. Near-zero turnover is the intent, and automated drift management is not live yet.",
    feeBps: 1000,
    minBuyUsd: 20,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "no automatic rebalancing yet — the basket holds exactly what you bought",
    launched: true,
    onChainId: 0,
  },
  {
    id: "silic",
    coverImage: "/groves/silic.webp",
    ticker: "$SILIC",
    name: "Silicon Grove",
    thesis: "The AI chip supply chain, from lithography to the server rack.",
    longThesis:
      "One basket across the whole semiconductor stack: the designers, the manufacturer, the equipment monopolies, memory, and the optical plumbing underneath the datacenter buildout. Concentrated in the leaders, with the semiconductor index spreading the single-name risk. This is a cyclical industry and the basket will swing with it.",
    category: "Sector",
    components: [
      { symbol: "NVDA", weightBps: 1670, reason: "The AI accelerator standard; the demand center of the whole basket." },
      { symbol: "TSM", weightBps: 1440, reason: "Manufactures nearly every advanced chip in this basket." },
      { symbol: "ASML", weightBps: 1220, reason: "EUV lithography monopoly — no ASML, no leading edge." },
      { symbol: "AMD", weightBps: 1110, reason: "The credible second source for AI accelerators." },
      { symbol: "AMAT", weightBps: 890, reason: "Deposition and etch equipment in every fab." },
      { symbol: "QCOM", weightBps: 890, reason: "Mobile and edge silicon plus a licensing stream." },
      { symbol: "MU", weightBps: 890, reason: "Memory — HBM demand tracks the AI buildout directly." },
      { symbol: "PLTR", weightBps: 780, reason: "The software layer selling AI to governments and enterprises." },
      { symbol: "SMCI", weightBps: 440, reason: "Builds the AI server racks; thin margins, high beta." },
      { symbol: "GLW", weightBps: 390, reason: "Glass and optical fiber underneath the datacenter boom." },
      { symbol: "LITE", weightBps: 280, reason: "Optical components for datacenter interconnect." },
    ],
    excluded: [
      { symbol: "AVGO", why: "Belongs here but is not yet routable on-chain." },
      { symbol: "MRVL", why: "Belongs here but is not yet routable on-chain." },
      { symbol: "SOXX", why: "No two-way venue route — the venues can buy it but not sell it back. Returns when it trades both ways." },
    ],
    methodology:
      "**Selection.** The semiconductor value chain end to end — design, manufacture, equipment, memory, integration, optics — plus one index tracker.\n\n" +
      "**Weighting.** Sized by role in the chain: irreplaceable monopolies largest, high-beta assemblers smallest.\n\n" +
      "**Rebalancing.** None automatic today: your basket holds exactly what you bought until you change it. Chips are cyclical; the basket does not pretend otherwise.",
    feeBps: 1000,
    // 11 names, smallest weight 2.8%: $80 clears the per-leg floor on every one.
    minBuyUsd: 80,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "no automatic rebalancing yet — the basket holds exactly what you bought",
    launched: false,
  },
  {
    id: "rails",
    coverImage: "/groves/rails.webp",
    ticker: "$RAILS",
    name: "Rails Grove",
    thesis: "Own the companies building crypto's rails, not the coins.",
    longThesis:
      "Equity exposure to the infrastructure of digital assets: the regulated exchange, the stablecoin issuer, the miners converting energy into compute, and the datacenters both industries rent. These are businesses with revenue, not tokens — but they move with crypto sentiment, and the swings are large.",
    category: "Sector",
    components: [
      { symbol: "COIN", weightBps: 2000, reason: "The regulated US exchange — trading, custody, and a USDC revenue share." },
      { symbol: "CRCL", weightBps: 1800, reason: "Issues USDC and earns on the reserves behind it." },
      { symbol: "CLSK", weightBps: 1600, reason: "Bitcoin miner scaling US energy capacity." },
      { symbol: "IREN", weightBps: 1600, reason: "Miner pivoting its rigs toward AI compute." },
      { symbol: "NBIS", weightBps: 1600, reason: "AI cloud infrastructure — the compute rail both industries need." },
      { symbol: "APLD", weightBps: 1400, reason: "Datacenters built for HPC and AI tenants." },
    ],
    excluded: [
      { symbol: "MSTR", why: "Not yet routable on-chain — and closer to a leveraged bitcoin position than a rails business." },
      { symbol: "SOFI", why: "Not yet routable on-chain." },
      { symbol: "GME", why: "Not yet routable on-chain." },
    ],
    methodology:
      "**Selection.** Listed companies whose business IS crypto infrastructure — exchange, stablecoin issuance, mining, and the datacenter capacity underneath — limited to names a venue can fill on-chain today.\n\n" +
      "**Weighting.** Fixed weights, heaviest on the businesses with the most durable revenue, no name above 20%.\n\n" +
      "**Rebalancing.** None automatic today: your basket holds exactly what you bought until you change it. Expect crypto-sized drawdowns.",
    feeBps: 1000,
    minBuyUsd: 20,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "no automatic rebalancing yet — the basket holds exactly what you bought",
    launched: false,
  },
];

/** Look up a grove by id (undefined if not in the registry). */
export function groveById(id: string): GroveDef | undefined {
  return GROVES.find((g) => g.id === id);
}

/** Our per-leg sizing floor for GROVES, USD — one source for pages + chat.
 *  NOT a venue rule: no live venue rejects a size.
 *
 *  A grove's legs all settle inside ONE transaction, so an extra name costs a
 *  marginal swap, not a whole UserOp: measured on 4663, an 8-leg buy is
 *  4,615,367 gas against 2,579,140 for 4 legs, i.e. ~509k gas (about 4 cents)
 *  per additional name. The invest path's $11 (RFQ_MIN_BUY_USD) is the floor
 *  for legs that ARE their own UserOp and does not apply here.
 *
 *  This must stay at or above the contract's own MIN_BUY_USDG dust guard and
 *  low enough that the smallest published weight clears it at minBuyUsd — the
 *  invariant below enforces exactly that. */
export const MIN_LEG_USD = 2;

export interface GroveLeg {
  symbol: string;
  weightPct: number;
  reason: string;
}

/** The legs a buy of amountUsd actually places. At or above minBuyUsd this is
 *  ALWAYS every component at its published weight — the invariant below
 *  guarantees the smallest weight clears MIN_LEG_USD there, so no name is ever
 *  dropped from a valid buy and two depositors of different size hold the same
 *  basket. The greedy remains as the safety net for below-minimum amounts a
 *  caller may still preview. One formula for pages + chat. */
export function groveLegsFor(g: GroveDef, amountUsd: number): GroveLeg[] {
  return capAllocationLegs(
    g.components.map((c) => ({ symbol: c.symbol, weightPct: c.weightBps / 100, reason: c.reason })),
    amountUsd,
    MIN_LEG_USD,
  );
}

/** The smallest buy at which EVERY component clears the ~$11 floor at its
 *  published weight — "from $N every name is included". Ceiled to a clean $10. */
export function fullDiversificationUsd(g: { components: { weightBps: number }[] }): number {
  const minBps = Math.min(...g.components.map((c) => c.weightBps));
  return Math.ceil((MIN_LEG_USD * 10_000) / minBps / 10) * 10;
}

// ── build-time validation ────────────────────────────────────────────────────
// A registry typo must fail the build, not ship a basket that can't execute.
// The minimum buy must place at least one leg that clears OUR ~$11 per-leg gas
// floor — Monvera's economics, not a venue rule; no venue imposes a minimum
// (small buys concentrate via groveLegsFor, so one clean leg is the real bar).

for (const g of GROVES) {
  const sum = g.components.reduce((s, c) => s + c.weightBps, 0);
  if (sum !== 10_000) {
    throw new Error(`Grove "${g.id}": weights sum to ${sum} bps, expected 10000.`);
  }
  for (const c of g.components) {
    if (!assetBySymbol(c.symbol)) {
      throw new Error(`Grove "${g.id}": component "${c.symbol}" is not in the token registry.`);
    }
    if (c.weightBps <= 0) {
      throw new Error(
        `Grove "${g.id}": component "${c.symbol}" has weight ${c.weightBps} bps — every weight must be positive (a zero weight makes fullDiversificationUsd divide by zero).`,
      );
    }
  }
  // THE UNIFORMITY INVARIANT. Every buy at or above the minimum must place
  // EVERY name, so the basket a depositor holds never depends on their size.
  // Violating this is what shipped before: minBuyUsd was $20 while the floor
  // was $11, so a $20 buy placed a single leg and "Titan Grove" meant 100% QQQ
  // at $20, 4 of 8 names at $50 and the full basket only from $100.
  const needed = fullDiversificationUsd(g);
  if (g.minBuyUsd < needed) {
    throw new Error(
      `Grove "${g.id}": minBuyUsd $${g.minBuyUsd} buys only part of the basket — ` +
        `its smallest weight (${Math.min(...g.components.map((c) => c.weightBps)) / 100}%) needs $${needed} ` +
        `to clear the $${MIN_LEG_USD} per-leg floor. Raise minBuyUsd to $${needed} or reweight.`,
    );
  }
  const dupes = new Set<string>();
  for (const c of g.components) {
    if (dupes.has(c.symbol)) throw new Error(`Grove "${g.id}": duplicate component "${c.symbol}".`);
    dupes.add(c.symbol);
  }
}
