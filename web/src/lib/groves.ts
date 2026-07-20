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
  /** False until the GroveManager contract is live — pages ship in preview. */
  launched: boolean;
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
      "**Rebalancing.** The screen re-runs quarterly. Between screens the basket is checked hourly and trades only on drift or risk events. A per-holding impure-income estimate is published so holders can purify that sliver.",
    feeBps: 1000,
    minBuyUsd: 20,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "checked hourly, trades only on drift or risk events",
    launched: false,
  },
  {
    id: "titan",
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
      "**Rebalancing.** Near-zero by design — checked hourly, trades only on drift or risk events.",
    feeBps: 1000,
    minBuyUsd: 20,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "checked hourly, trades only on drift or risk events",
    launched: false,
  },
  {
    id: "silic",
    ticker: "$SILIC",
    name: "Silicon Grove",
    thesis: "The AI chip supply chain, from lithography to the server rack.",
    longThesis:
      "One basket across the whole semiconductor stack: the designers, the manufacturer, the equipment monopolies, memory, and the optical plumbing underneath the datacenter buildout. Concentrated in the leaders, with the semiconductor index spreading the single-name risk. This is a cyclical industry and the basket will swing with it.",
    category: "Sector",
    components: [
      { symbol: "NVDA", weightBps: 1500, reason: "The AI accelerator standard; the demand center of the whole basket." },
      { symbol: "TSM", weightBps: 1300, reason: "Manufactures nearly every advanced chip in this basket." },
      { symbol: "ASML", weightBps: 1100, reason: "EUV lithography monopoly — no ASML, no leading edge." },
      { symbol: "AMD", weightBps: 1000, reason: "The credible second source for AI accelerators." },
      { symbol: "SOXX", weightBps: 1000, reason: "Tracks the semiconductor index, spreading single-name risk." },
      { symbol: "AMAT", weightBps: 800, reason: "Deposition and etch equipment in every fab." },
      { symbol: "QCOM", weightBps: 800, reason: "Mobile and edge silicon plus a licensing stream." },
      { symbol: "MU", weightBps: 800, reason: "Memory — HBM demand tracks the AI buildout directly." },
      { symbol: "PLTR", weightBps: 700, reason: "The software layer selling AI to governments and enterprises." },
      { symbol: "SMCI", weightBps: 400, reason: "Builds the AI server racks; thin margins, high beta." },
      { symbol: "GLW", weightBps: 350, reason: "Glass and optical fiber underneath the datacenter boom." },
      { symbol: "LITE", weightBps: 250, reason: "Optical components for datacenter interconnect." },
    ],
    excluded: [
      { symbol: "AVGO", why: "Belongs here but is not yet routable on-chain." },
      { symbol: "MRVL", why: "Belongs here but is not yet routable on-chain." },
    ],
    methodology:
      "**Selection.** The semiconductor value chain end to end — design, manufacture, equipment, memory, integration, optics — plus one index tracker.\n\n" +
      "**Weighting.** Sized by role in the chain: irreplaceable monopolies largest, high-beta assemblers smallest.\n\n" +
      "**Rebalancing.** Checked hourly, trades only on drift or risk events. Chips are cyclical; the basket does not pretend otherwise.",
    feeBps: 1000,
    minBuyUsd: 20,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "checked hourly, trades only on drift or risk events",
    launched: false,
  },
  {
    id: "rails",
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
      "**Rebalancing.** Checked hourly, trades only on drift or risk events. Expect crypto-sized drawdowns.",
    feeBps: 1000,
    minBuyUsd: 20,
    recommendedUsd: RECOMMENDED_BUY_USD,
    rebalancePolicy: "checked hourly, trades only on drift or risk events",
    launched: false,
  },
];

/** Look up a grove by id (undefined if not in the registry). */
export function groveById(id: string): GroveDef | undefined {
  return GROVES.find((g) => g.id === id);
}

/** The ~venue floor per placed order, USD. One source for pages + chat. */
export const MIN_LEG_USD = 11;

export interface GroveLeg {
  symbol: string;
  weightPct: number;
  reason: string;
}

/** The legs a buy of amountUsd actually places. Small buys CONCENTRATE: the
 *  same capAllocationLegs greedy the invest plans use keeps components by
 *  descending weight and drops the tail until every kept leg clears the ~$11
 *  venue floor at renormalized weights. Full diversification returns as the
 *  amount grows (fullDiversificationUsd). One formula for pages + chat. */
export function groveLegsFor(g: GroveDef, amountUsd: number): GroveLeg[] {
  return capAllocationLegs(
    g.components.map((c) => ({ symbol: c.symbol, weightPct: c.weightBps / 100, reason: c.reason })),
    amountUsd,
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
// The minimum buy must place at least one leg that clears the ~$11 venue floor
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
  }
  if (g.minBuyUsd < MIN_LEG_USD) {
    throw new Error(
      `Grove "${g.id}": minBuyUsd $${g.minBuyUsd} is under the $${MIN_LEG_USD} venue floor — even a fully concentrated buy could not fill.`,
    );
  }
  const dupes = new Set<string>();
  for (const c of g.components) {
    if (dupes.has(c.symbol)) throw new Error(`Grove "${g.id}": duplicate component "${c.symbol}".`);
    dupes.add(c.symbol);
  }
}
