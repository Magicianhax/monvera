import "server-only";

// Live tradability: can ANY venue (Uniswap -> LiFi -> Arcus -> Rialto) fill a
// $15 buy of this symbol right now — AND buy it back? Two-way is the bar:
// LiFi's fly tool has one-directional books (it could buy AAOI/SOXX but not
// sell them), which strands users in positions with no exit. Plan builders and
// every buy surface call this BEFORE offering a stock, so nothing sellable-in-
// theory-only is ever served. Probes are cheap price calls, cached per symbol
// for 10 minutes.
import type { Address } from "viem";
import { getPrice } from "./arcus";
import { lifiPrice, lifiExecQuote } from "./lifiStocks";
import { rialtoPrice, rialtoEnabled } from "./rialto";
import { uniV4Price, uniV4Quote } from "./uniswapV4";
import { venueEnabled } from "./venueFlags";
import { assetBySymbol, USDG } from "@/lib/tokens";

// Any valid address works as the probe taker — price quotes don't check balances.
const PROBE_TAKER = "0xc6d7709dd8ba53832bd578a88260f8b8e59fb4c7" as Address;
const PROBE_USDG = BigInt(15_000_000); // $15 — the venue-minimum ballpark
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { ok: boolean; at: number }>();

/** Venue ladder for one direction; returns the best output or null.
 *  One delayed retry when everything misses — LiFi 429s otherwise read as
 *  "no liquidity" and poison the sweep with false negatives.
 *
 *  EXECUTABLE quotes first, indicative price second. A venue can price a pair
 *  it cannot actually build a transaction for, and an asset that prices but
 *  won't execute is exactly the kind we must never offer: the user only finds
 *  out at invest time. The price call stays as a fallback so a transient
 *  quote-builder error doesn't lock an otherwise healthy name. */
async function probeVenues(sellToken: Address, buyToken: Address, sellRaw: bigint, sellDec: number, retry = true): Promise<bigint | null> {
  let out: bigint | null = null;
  if (venueEnabled("uniswap")) {
    out = await uniV4Quote(sellToken, buyToken, sellRaw, PROBE_TAKER).then((q) => q?.buyAmount ?? null).catch(() => null);
    if (out === null) out = await uniV4Price(sellToken, buyToken, sellRaw).catch(() => null);
  }
  if (out === null && venueEnabled("lifi")) {
    out = await lifiExecQuote(sellToken, buyToken, sellRaw, PROBE_TAKER, PROBE_TAKER).then((q) => q?.buyAmount ?? null).catch(() => null);
    if (out === null) out = await lifiPrice(sellToken, buyToken, sellRaw, PROBE_TAKER).catch(() => null);
  }
  if (out === null && venueEnabled("arcus")) {
    out = await getPrice(sellToken, buyToken, sellRaw).then((r) => (r.liquidityAvailable ? r.buyAmount : null)).catch(() => null);
  }
  if (out === null && venueEnabled("rialto") && rialtoEnabled()) {
    out = await rialtoPrice(sellToken, buyToken, sellRaw, sellDec, PROBE_TAKER).catch(() => null);
  }
  if (out === null && retry) {
    await new Promise((r) => setTimeout(r, 1_500));
    return probeVenues(sellToken, buyToken, sellRaw, sellDec, false);
  }
  return out;
}

// ── the locked list is AUTHORITATIVE ────────────────────────────────────────
// The hourly sweep (cron -> KV, with 2-miss hysteresis) is the same source the
// market UI and order ticket use to lock a name. Plan building used to consult
// only live probes, so a name the UI showed as locked could still land in a
// plan — SOXX did exactly that, and its leg died at invest time. Whatever the
// sweep locked stays locked here; a live probe can never override it.
let lockedCache: { at: number; set: Set<string> } | null = null;
const LOCKED_TTL_MS = 60_000;

/** The locked set, for callers that need it before probing (e.g. the plan
 *  builder trims its prompt universe with it). */
export async function lockedSet(): Promise<Set<string>> {
  return lockedSymbols();
}

async function lockedSymbols(): Promise<Set<string>> {
  if (lockedCache && Date.now() - lockedCache.at < LOCKED_TTL_MS) return lockedCache.set;
  let set = new Set<string>();
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as { KV?: { get(k: string): Promise<string | null> } };
    const raw = await env.KV?.get(TRADABILITY_KV_KEY);
    if (raw) set = new Set((JSON.parse(raw) as { dropped?: string[] }).dropped ?? []);
  } catch {
    // No KV (local dev) or a bad read: fall through to live probes only. The
    // sweep is a safety net over probing, never the sole gate.
  }
  lockedCache = { at: Date.now(), set };
  return set;
}

/** True when some venue can fill a $15 buy of `symbol` AND sell it back. */
export async function isTradable(symbol: string): Promise<boolean> {
  if ((await lockedSymbols()).has(symbol.toUpperCase())) return false;

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;

  const asset = assetBySymbol(symbol);
  if (!asset) return false;
  const usdg = USDG.address as Address;
  const stock = asset.address as Address;

  // Buy first — its output is exactly the position a $15 buyer would hold, so
  // the sell probe asks the only question that matters: could they get out?
  const bought = await probeVenues(usdg, stock, PROBE_USDG, USDG.decimals);
  let ok = false;
  if (bought !== null && bought > BigInt(0)) {
    ok = (await probeVenues(stock, usdg, bought, asset.decimals ?? 18)) !== null;
  }

  cache.set(symbol, { ok, at: Date.now() });
  return ok;
}

/**
 * Indicative pre-trade quote: how much of `symbol` would `usdIn` buy right
 * now (or how many dollars would `usdIn` worth of it fetch on a sell), from
 * the same cheap venue price probes — NEVER a signable quote. Raw output
 * units of the buy token; null when no venue can price it. Cached ~30s.
 */
const quoteCache = new Map<string, { out: bigint | null; at: number }>();
export async function indicativeQuote(symbol: string, side: "buy" | "sell", usdAmount: number): Promise<{ outRaw: bigint; sellRaw: bigint } | null> {
  const asset = assetBySymbol(symbol);
  if (!asset) return null;
  const usdg = USDG.address as Address;
  const stock = asset.address as Address;
  // Sells are sized in dollars too: convert via a $15 buy probe first to get a
  // price, then quote the actual token quantity. Keep it simple: quote the
  // dollar leg direction directly with a proportional input.
  const sellRaw = side === "buy"
    ? BigInt(Math.round(usdAmount * 1e6))
    : BigInt(0); // filled below for sells
  if (side === "buy") {
    const key = `${symbol}:buy:${usdAmount.toFixed(2)}`;
    const hit = quoteCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.out === null ? null : { outRaw: hit.out, sellRaw };
    let out: bigint | null = null;
    if (venueEnabled("uniswap")) out = await uniV4Price(usdg, stock, sellRaw);
    if (out === null && venueEnabled("lifi")) out = await lifiPrice(usdg, stock, sellRaw, PROBE_TAKER);
    if (out === null && venueEnabled("arcus")) {
      out = await getPrice(usdg, stock, sellRaw).then((r) => (r.liquidityAvailable ? r.buyAmount : null)).catch(() => null);
    }
    if (out === null && venueEnabled("rialto") && rialtoEnabled()) {
      out = await rialtoPrice(usdg, stock, sellRaw, USDG.decimals, PROBE_TAKER);
    }
    quoteCache.set(key, { out, at: Date.now() });
    return out === null ? null : { outRaw: out, sellRaw };
  }
  // sell: derive token qty for usdAmount from a probe price, then quote it.
  const probe = await indicativeQuote(symbol, "buy", 15);
  if (!probe || probe.outRaw <= BigInt(0)) return null;
  const tokensPerUsd = Number(probe.outRaw) / 1e18 / 15;
  const qty = usdAmount * tokensPerUsd;
  const tokenRaw = BigInt(Math.round(qty * 1e6)) * BigInt(1e12); // avoid float overflow
  const key = `${symbol}:sell:${usdAmount.toFixed(2)}`;
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.out === null ? null : { outRaw: hit.out, sellRaw: tokenRaw };
  let out: bigint | null = null;
  if (venueEnabled("uniswap")) out = await uniV4Price(stock, usdg, tokenRaw);
  if (out === null && venueEnabled("lifi")) out = await lifiPrice(stock, usdg, tokenRaw, PROBE_TAKER);
  if (out === null && venueEnabled("arcus")) {
    out = await getPrice(stock, usdg, tokenRaw).then((r) => (r.liquidityAvailable ? r.buyAmount : null)).catch(() => null);
  }
  if (out === null && venueEnabled("rialto") && rialtoEnabled()) {
    out = await rialtoPrice(stock, usdg, tokenRaw, 18, PROBE_TAKER);
  }
  quoteCache.set(key, { out, at: Date.now() });
  return out === null ? null : { outRaw: out, sellRaw: tokenRaw };
}

/** Partition symbols into live-tradable vs dead, probing all in parallel. */
export async function filterTradable(symbols: string[]): Promise<{ ok: string[]; dropped: string[] }> {
  const locked = await lockedSymbols();
  const results = await Promise.all(
    symbols.map(async (s) => ({
      s,
      // A locked name is never kept. Otherwise fail OPEN on a probe error: a
      // flaky venue must not empty someone's plan — but it must not resurrect
      // a name the sweep already locked either.
      ok: locked.has(s.toUpperCase()) ? false : await isTradable(s).catch(() => true),
    })),
  );
  return {
    ok: results.filter((r) => r.ok).map((r) => r.s),
    dropped: results.filter((r) => !r.ok).map((r) => r.s),
  };
}

// ── universe sweep ───────────────────────────────────────────────────────────
// Full two-way probe of every stock/ETF, for the hourly cron. Modest
// concurrency: each symbol costs up to 2 venue-ladder walks, and LiFi rate
// limits are shared with real user quotes.
export const TRADABILITY_KV_KEY = "tradability:v1";

export interface TradabilitySweep {
  /** Symbols with a live buy AND sell route. */
  ok: string[];
  /** Symbols missing one or both directions right now. */
  dropped: string[];
  asOf: string;
}

export async function sweepTradability(): Promise<TradabilitySweep> {
  const { ALL_ASSETS } = await import("@/lib/tokens");
  const symbols = ALL_ASSETS.filter((a) => a.tier === "stock" || a.tier === "etf").map((a) => a.symbol);
  const ok: string[] = [];
  const dropped: string[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (s) => ({ s, ok: await isTradable(s).catch(() => false) })));
    for (const r of results) (r.ok ? ok : dropped).push(r.s);
  }
  return { ok, dropped, asOf: new Date().toISOString() };
}

/** A few always-liquid alternatives to suggest when a requested symbol is dead. */
export async function liquidSuggestions(exclude: string, max = 3): Promise<string[]> {
  const majors = ["AAPL", "NVDA", "MSFT", "SPY", "GOOGL", "AMZN"].filter((s) => s !== exclude.toUpperCase());
  const { ok } = await filterTradable(majors);
  return ok.slice(0, max);
}
