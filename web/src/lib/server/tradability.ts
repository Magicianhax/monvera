import "server-only";

// Live tradability: can ANY venue (Arcus -> LiFi -> Rialto) actually fill a
// $15 buy of this symbol right now? Plan builders call this BEFORE proposing
// legs, so Vera never recommends a stock nobody can execute — the old failure
// was silent leg-skips at invest time. Probes are cheap price calls, run in
// parallel per plan (≤ ~10 symbols) and cached per symbol for 10 minutes.
import type { Address } from "viem";
import { getPrice } from "./arcus";
import { lifiPrice } from "./lifiStocks";
import { rialtoPrice, rialtoEnabled } from "./rialto";
import { uniV4Price } from "./uniswapV4";
import { venueEnabled } from "./venueFlags";
import { assetBySymbol, USDG } from "@/lib/tokens";

// Any valid address works as the probe taker — price quotes don't check balances.
const PROBE_TAKER = "0xc6d7709dd8ba53832bd578a88260f8b8e59fb4c7" as Address;
const PROBE_USDG = BigInt(15_000_000); // $15 — the venue-minimum ballpark
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { ok: boolean; at: number }>();

/** True when at least one venue can price a $15 buy of `symbol` right now. */
export async function isTradable(symbol: string): Promise<boolean> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;

  const asset = assetBySymbol(symbol);
  if (!asset) return false;
  const usdg = USDG.address as Address;
  const stock = asset.address as Address;

  let ok = false;
  if (venueEnabled("uniswap")) ok = (await uniV4Price(usdg, stock, PROBE_USDG)) !== null;
  if (!ok && venueEnabled("lifi")) ok = (await lifiPrice(usdg, stock, PROBE_USDG, PROBE_TAKER)) !== null;
  if (!ok && venueEnabled("arcus")) {
    ok = await getPrice(usdg, stock, PROBE_USDG).then((r) => r.liquidityAvailable).catch(() => false);
  }
  if (!ok && venueEnabled("rialto") && rialtoEnabled()) {
    ok = (await rialtoPrice(usdg, stock, PROBE_USDG, USDG.decimals, PROBE_TAKER)) !== null;
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
  const results = await Promise.all(symbols.map(async (s) => ({ s, ok: await isTradable(s).catch(() => true) })));
  return {
    ok: results.filter((r) => r.ok).map((r) => r.s),
    dropped: results.filter((r) => !r.ok).map((r) => r.s),
  };
}

/** A few always-liquid alternatives to suggest when a requested symbol is dead. */
export async function liquidSuggestions(exclude: string, max = 3): Promise<string[]> {
  const majors = ["AAPL", "NVDA", "MSFT", "SPY", "GOOGL", "AMZN"].filter((s) => s !== exclude.toUpperCase());
  const { ok } = await filterTradable(majors);
  return ok.slice(0, max);
}
