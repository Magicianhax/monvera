import "server-only";

// The open theme book — one deterministic, reproducible basket per investing
// theme (AI, semiconductors, space, ...), computed by the SAME engine that
// builds the public strategies: real 12-month closes, inverse-volatility
// weights, and an honest walk-forward backtest vs SPY. No AI in the loop.
//
// Public at /themes + /api/themes so people AND agents can consume it.
// Excluded symbols are named, never synthesized.
import { ETFS } from "@/lib/tokens";
import { THEMES } from "@/lib/marketSearch";
import {
  buildUniverseData,
  inverseVolWeights,
  walkForward,
  type StrategyAllocation,
  type StrategyBacktest,
} from "./strategies";

const WEIGHT_CAP_PCT = 25;

export interface ThemeDef {
  slug: string;
  /** Key into marketSearch THEMES — the curated symbol set. */
  themeKey: keyof typeof THEMES & string;
  name: string;
  tagline: string;
}

// The canonical, curated set (THEMES also holds search synonyms — those are
// not separate books). Order = display order.
export const THEME_DEFS: ThemeDef[] = [
  { slug: "ai", themeKey: "ai", name: "Artificial Intelligence", tagline: "The compute, the models, and the companies selling shovels." },
  { slug: "semiconductors", themeKey: "semiconductor", name: "Semiconductors", tagline: "The fabs, designers, and equipment behind every chip." },
  { slug: "quantum", themeKey: "quantum", name: "Quantum Computing", tagline: "Small universe, wild swings: the listed quantum pure-plays." },
  { slug: "space", themeKey: "space", name: "Space", tagline: "Launch, satellites, and the new orbital economy." },
  { slug: "crypto", themeKey: "crypto", name: "Crypto-linked Stocks", tagline: "Equity exposure to the crypto economy, no tokens involved." },
  { slug: "cloud", themeKey: "cloud", name: "Cloud & Software", tagline: "Recurring-revenue software and the platforms it runs on." },
  { slug: "energy", themeKey: "energy", name: "Energy", tagline: "From oil majors to nuclear and grid storage." },
  { slug: "fintech", themeKey: "fintech", name: "Fintech", tagline: "The companies rebuilding money rails." },
];

export interface PublicTheme {
  slug: string;
  name: string;
  tagline: string;
  /** The full rule, in plain words — enough to reproduce the weights. */
  method: string;
  /** Symbols in the curated theme that the book had to exclude, with why. */
  excluded: { symbol: string; reason: string }[];
  allocations: StrategyAllocation[];
  backtest: StrategyBacktest | null;
}

export interface ThemesPayload {
  asOf: string;
  refreshedEvery: string;
  note: string;
  themes: PublicTheme[];
}

const PAYLOAD_TTL_MS = 6 * 60 * 60_000;
let payloadCache: { at: number; value: Promise<ThemesPayload> } | null = null;

function methodFor(def: ThemeDef, memberCount: number): string {
  return (
    `Universe: the ${memberCount} tokenized ${def.name} names with 12 months of public history ` +
    `(the curated ${def.name} set, exclusions named below). Weights: inverse to each asset's ` +
    `annualized daily volatility, capped at ${WEIGHT_CAP_PCT}% per name (excess redistributes). ` +
    `Rebalanced monthly. Refreshed from market data every 6 hours.`
  );
}

async function build(): Promise<ThemesPayload> {
  // One shared fetch across all themes: union of every curated set.
  const union = [...new Set([...THEME_DEFS.flatMap((d) => THEMES[d.themeKey] ?? []), "SPY"])];
  const { stats, tails, skipped } = await buildUniverseData(union);
  const statBySym = new Map(stats.map((a) => [a.symbol, a]));
  const etfSyms = new Set(ETFS.map((a) => a.symbol));

  const themes: PublicTheme[] = THEME_DEFS.map((def) => {
    const curated = THEMES[def.themeKey] ?? [];
    const members = curated.filter((s) => statBySym.has(s));
    const memberSet = new Set(members);
    const excluded = curated
      .filter((s) => skipped.includes(s))
      .map((symbol) => ({ symbol, reason: "no 12-month public price history yet" }));

    const memberStats = members.map((s) => statBySym.get(s)!);
    const allocations = inverseVolWeights(memberStats, WEIGHT_CAP_PCT);

    // Walk-forward over ONLY this theme's series (+ SPY for the benchmark).
    // The rule re-derives inverse-vol weights from what was knowable at each
    // monthly rebalance, exactly like the main strategy book.
    const themeTails = new Map<string, number[]>();
    for (const s of [...members, "SPY"]) {
      const t = tails.get(s);
      if (t) themeTails.set(s, t);
    }
    let backtest: StrategyBacktest | null = null;
    try {
      backtest = walkForward(
        (etfs, stocks) =>
          inverseVolWeights(
            [...etfs, ...stocks].filter((a) => memberSet.has(a.symbol)),
            WEIGHT_CAP_PCT,
          ),
        themeTails,
        etfSyms,
      );
    } catch {
      /* a data hiccup never hides the theme itself */
    }

    return {
      slug: def.slug,
      name: def.name,
      tagline: def.tagline,
      method: methodFor(def, members.length),
      excluded,
      allocations,
      backtest,
    };
  });

  return {
    asOf: new Date().toISOString(),
    refreshedEvery: "6h",
    note:
      "Deterministic theme baskets over real daily closes (real underlying tickers). Backtests are " +
      "WALK-FORWARD: each month the rule re-runs using only the data it would have had at that moment, " +
      "then holds out-of-sample, monthly rebalance, vs buy-and-hold SPY over the same window. " +
      "History, not a promise: markets change.",
    themes,
  };
}

/** The public themes payload (cached 6h; failed builds are not cached). */
export function getPublicThemes(): Promise<ThemesPayload> {
  if (payloadCache && Date.now() - payloadCache.at < PAYLOAD_TTL_MS) return payloadCache.value;
  const value = build().catch((err) => {
    payloadCache = null;
    throw err;
  });
  payloadCache = { at: Date.now(), value };
  return value;
}

export function getThemeDef(slug: string): ThemeDef | undefined {
  return THEME_DEFS.find((d) => d.slug === slug);
}
