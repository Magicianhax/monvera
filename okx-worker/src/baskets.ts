// Themed baskets + published shariah screen.
// Screen basis: AAOIFI sector + ratio screens per tasks/plans/2026-07-17-halal-fund-plan.md
// (screen decisions carried over; the wrapper-token product it fed was superseded,
// the screening research remains valid).
// Copy rule: "shariah-screened, certification in progress" — never "certified".
import type { Allocation } from "./allocation-schema";
import { capAllocationLegs, SOL_MIN_LEG_USD } from "./legMath";
import { UNIVERSE, assetBySymbol } from "./universe";

export type BasketId = "halal" | "blue-chip" | "index" | "ai-semis" | "dividend" | "momentum" | "barbell";

export type BasketDef = {
  id: BasketId;
  title: string;
  description: string;
  /** Underlying tickers; resolved to xStock symbols at build time. */
  tickers: string[];
  weighting: "cap-proxy" | "equal" | "momentum";
  singleNameCapPct: number;
};

export type ScreenVerdict = "pass" | "fail" | "doubtful" | "unknown";

export const HALAL_SCREEN: Record<string, { verdict: Exclude<ScreenVerdict, "unknown">; reason: string }> = {
  NVDA: { verdict: "pass", reason: "Sector pass; debt and impure income within AAOIFI thresholds." },
  MSFT: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  AAPL: { verdict: "pass", reason: "Sector pass; debt ratio borderline, monitored quarterly." },
  GOOGL: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  AMZN: { verdict: "pass", reason: "Sector pass; impure income share monitored." },
  META: { verdict: "pass", reason: "Sector pass; impure income share monitored." },
  TSM: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  AVGO: { verdict: "pass", reason: "Sector pass; debt ratio flagged, monitored." },
  TSLA: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  LLY: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  ASML: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  AMD: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  XOM: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  ABT: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  JNJ: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  PG: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  KO: { verdict: "doubtful", reason: "Beverage sector pass, but impure income share under review." },
  PEP: { verdict: "doubtful", reason: "Beverage sector pass, but impure income share under review." },
  MCD: { verdict: "doubtful", reason: "Menu items and franchise interest income under review." },
  SPY: { verdict: "fail", reason: "Index fund holding non-compliant constituents (banks, insurers)." },
  QQQ: { verdict: "fail", reason: "Index fund holding non-compliant constituents." },
  GLD: { verdict: "doubtful", reason: "Gold exposure is permissible; fund structure (paper claim) under review." },
  COIN: { verdict: "doubtful", reason: "Interest-on-reserves revenue share under review." },
  HOOD: { verdict: "fail", reason: "Interest-based brokerage revenue (margin, securities lending)." },
  JPM: { verdict: "fail", reason: "Banking (riba)." },
  V: { verdict: "fail", reason: "Payment network fees tied to interest-bearing credit." },
  NFLX: { verdict: "fail", reason: "Impermissible content production exceeds screen." },
  MSTR: { verdict: "fail", reason: "Leveraged interest-bearing debt structure." },
  CRCL: { verdict: "fail", reason: "Interest-on-reserves business model." },
  STRC: { verdict: "fail", reason: "Interest-bearing preferred structure." },
  PFE: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  MRK: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  AZN: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  NVO: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  CSCO: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  ORCL: { verdict: "pass", reason: "Sector pass; debt ratio monitored." },
  CRM: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  INTC: { verdict: "pass", reason: "Sector pass; ratios within thresholds." },
  WMT: { verdict: "doubtful", reason: "Alcohol and tobacco share of revenue under review." },
  UNH: { verdict: "fail", reason: "Insurance (gharar)." },
  PLTR: { verdict: "fail", reason: "Weapons and defense exposure." },
  SPCX: { verdict: "doubtful", reason: "Private-company token; insufficient financial disclosure to screen." },
};

export function screenSymbols(
  symbols: string[]
): Array<{ symbol: string; verdict: ScreenVerdict; reason: string }> {
  return symbols.map((symbol) => {
    const key = (assetBySymbol(symbol)?.underlying ?? symbol).toUpperCase();
    const hit = HALAL_SCREEN[key];
    return hit
      ? { symbol, ...hit }
      : { symbol, verdict: "unknown", reason: "Not yet screened; treat as excluded until reviewed." };
  });
}

function inUniverse(tickers: string[]): string[] {
  return tickers.filter((t) => assetBySymbol(t) !== undefined);
}

export const BASKETS: Record<BasketId, BasketDef> = {
  halal: {
    id: "halal",
    title: "Halal Basket",
    description:
      "AAOIFI shariah-screened tokenized stocks (sector and ratio screens; certification in progress). Only screen-pass names; published exclusions on request.",
    tickers: inUniverse(
      Object.entries(HALAL_SCREEN)
        .filter(([, v]) => v.verdict === "pass")
        .map(([t]) => t)
    ),
    weighting: "cap-proxy",
    singleNameCapPct: 15,
  },
  "blue-chip": {
    id: "blue-chip",
    title: "Blue Chip Basket",
    description: "Mega-cap leaders with the deepest tokenized-stock liquidity.",
    tickers: inUniverse(["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"]),
    weighting: "cap-proxy",
    singleNameCapPct: 25,
  },
  index: {
    id: "index",
    title: "Index Basket",
    description: "Broad-market ETF core.",
    tickers: inUniverse(["SPY", "QQQ"]),
    weighting: "equal",
    singleNameCapPct: 60,
  },
  "ai-semis": {
    id: "ai-semis",
    title: "AI & Semiconductors",
    description: "The AI compute supply chain.",
    tickers: inUniverse(["NVDA", "AMD", "TSM", "AVGO", "ASML", "INTC", "MSFT"]),
    weighting: "cap-proxy",
    singleNameCapPct: 25,
  },
  dividend: {
    id: "dividend",
    title: "Dividend & Defensive",
    description: "Defensive payers for lower-volatility exposure.",
    tickers: inUniverse(["JNJ", "PG", "KO", "XOM", "LLY", "MCD", "PEP", "ABT"]),
    weighting: "equal",
    singleNameCapPct: 25,
  },
  momentum: {
    id: "momentum",
    title: "Momentum Basket",
    description: "Top trailing risk-adjusted movers in the universe, refreshed from live stats.",
    tickers: [], // resolved dynamically in resolveBasket
    weighting: "momentum",
    singleNameCapPct: 25,
  },
  barbell: {
    id: "barbell",
    title: "Barbell Basket",
    description: "Index core with growth satellites.",
    tickers: inUniverse(["SPY", "QQQ", "NVDA", "TSLA", "AMD"]),
    weighting: "equal",
    singleNameCapPct: 40,
  },
};

// Static cap-proxy tiers (avoids a live market-cap dependency): mega=3, large=2, mid=1.
const CAP_PROXY_WEIGHTS: Record<string, number> = {
  NVDA: 3, MSFT: 3, AAPL: 3, GOOGL: 3, AMZN: 3, META: 3,
  TSLA: 2, AVGO: 2, TSM: 2, LLY: 2, ASML: 2, XOM: 2, JNJ: 2, PG: 2, WMT: 2, ORCL: 2,
  AMD: 1, INTC: 1, KO: 1, MCD: 1, PEP: 1, ABT: 1, PFE: 1, MRK: 1, AZN: 1, NVO: 1,
  CSCO: 1, CRM: 1, SPY: 2, QQQ: 2,
};

const BASKET_RISK: Record<BasketId, number> = {
  halal: 5000,
  "blue-chip": 5500,
  index: 3200,
  "ai-semis": 6500,
  dividend: 3500,
  momentum: 7000,
  barbell: 4500,
};

/** Apply the single-name cap, redistributing overflow to uncapped legs. */
function applyCap<T extends { weightPct: number }>(legs: T[], capPct: number): T[] {
  let out = legs;
  for (let pass = 0; pass < 4; pass++) {
    const overflow = out.reduce((s, a) => s + Math.max(0, a.weightPct - capPct), 0);
    if (overflow < 1e-6) break;
    const underTotal = out.filter((a) => a.weightPct < capPct).reduce((s, a) => s + a.weightPct, 0);
    if (underTotal <= 0) break;
    out = out.map((a) =>
      a.weightPct > capPct
        ? { ...a, weightPct: capPct }
        : { ...a, weightPct: a.weightPct + (overflow * a.weightPct) / underTotal }
    );
  }
  return out;
}

export async function resolveBasket(id: BasketId, amountUsd: number): Promise<Allocation> {
  const def = BASKETS[id];
  let tickers = def.tickers;
  if (def.weighting === "momentum") {
    const { momentumRank } = await import("./quantExtras");
    tickers = await momentumRank(
      UNIVERSE.map((a) => a.underlying),
      6
    );
  }
  const raw = tickers.flatMap((t) => {
    const asset = assetBySymbol(t);
    if (!asset) return [];
    const base = def.weighting === "cap-proxy" ? (CAP_PROXY_WEIGHTS[t.toUpperCase()] ?? 1) : 1;
    return [{ symbol: asset.symbol, weightPct: base, reason: `${def.title} constituent.` }];
  });
  const total = raw.reduce((s, a) => s + a.weightPct, 0) || 1;
  const scaled = raw.map((a) => ({ ...a, weightPct: (a.weightPct / total) * 100 }));
  const capped = capAllocationLegs(applyCap(scaled, def.singleNameCapPct), amountUsd, SOL_MIN_LEG_USD);
  return {
    summary: `${def.title}: ${capped.length} tokenized stocks for $${amountUsd}.`,
    rationale: def.description,
    riskScore: BASKET_RISK[id],
    allocations: capped,
  };
}
