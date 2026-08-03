import "server-only";

// One place that answers "what is this asset worth right now".
//
// Only ~a third of the universe has a Chainlink feed on this young chain, so
// priceAll() alone leaves most stocks unpriced — they rendered a bare "—" in
// holdings, on the sell sheet, and in price alerts, even for positions the user
// holds. Arcus quotes every tradable asset, so we fill the gaps from an
// indicative quote — but only while the venue is switched on (VENUE_ARCUS is
// off today, so that tier is dormant and the market-close tier carries the
// gaps). Assets neither source can price stay honestly unpriced.
//
// Every server caller (prices, portfolio, alerts) must go through here; calling
// priceAll() directly is what let holdings and the market list disagree.
import type { PublicClient } from "viem";
import { ALL_ASSETS, type Asset } from "@/lib/tokens";
import { priceAll, type AssetPrice } from "@/lib/prices";
import { arcusPriceUsd } from "@/lib/server/arcus";
import { venueEnabled } from "@/lib/server/venueFlags";
import { getDaySummary } from "@/lib/server/marketData";

// Small batches: a cold cache would otherwise fire ~60 quotes at once and the
// router rate-limits per IP — which every user of ours shares.
const ARCUS_BATCH = 6;
// A cold cache must never hold the page hostage. We spend a small budget filling
// what we can from Arcus; anything we don't reach still prices from the
// market-close tier below, and the per-token Arcus cache (5 min) upgrades the
// source across refreshes.
const ARCUS_BUDGET_MS = 2_000;
// Rotate where each sweep starts. With a fixed order, the budget always expired
// on the SAME tail symbols (NFLX and friends), so they never got a live quote.
let sweepOffset = 0;
// Router-level failures (every quote in a sweep dying, not a token-level "no" —
// those are negative-cached inside arcus.ts) were never remembered, so every
// sweep re-spent its whole budget timing out against a dead endpoint. Remember
// the outage briefly. In-memory is fine here: this is per-isolate backoff, not
// shared data — the worst case is one wasted probe per cold isolate per minute.
const ARCUS_OUTAGE_BACKOFF_MS = 60_000;
let arcusRetryAt = 0;

export async function priceAllWithFallback(
  client: PublicClient,
  assets: Asset[] = ALL_ASSETS,
): Promise<Record<string, AssetPrice>> {
  // Tier 1: Chainlink feeds (34 of 95).
  const chainlink = await priceAll(client, assets);
  const missing = assets.filter((a) => chainlink[a.symbol]?.priceUsd === undefined);
  if (missing.length === 0) return chainlink;

  const filled: Record<string, AssetPrice> = { ...chainlink };

  // Tier 2: live Arcus quotes — budgeted, rotated. Skipped entirely while the
  // venue is flagged off (VENUE_ARCUS) or inside the outage backoff: quoting a
  // router that can't answer only burns budget the market-close tier could use.
  if (venueEnabled("arcus") && Date.now() >= arcusRetryAt) {
    const start = sweepOffset % missing.length;
    sweepOffset += ARCUS_BATCH;
    const rotated = [...missing.slice(start), ...missing.slice(0, start)];
    const deadline = Date.now() + ARCUS_BUDGET_MS;
    let attempted = 0;
    let quoted = 0;
    for (let i = 0; i < rotated.length; i += ARCUS_BATCH) {
      if (Date.now() > deadline) break;
      const batch = rotated.slice(i, i + ARCUS_BATCH);
      const priced = await Promise.all(
        batch.map(async (a) => [a.symbol, await arcusPriceUsd(a.address, a.decimals)] as const),
      );
      attempted += batch.length;
      for (const [symbol, priceUsd] of priced) {
        if (priceUsd !== undefined) {
          filled[symbol] = { symbol, priceUsd, source: "arcus" };
          quoted += 1;
        }
      }
    }
    // A sweep that priced NOTHING it attempted is a router-level failure — a
    // live router prices at least part of a batch, and cached per-token "no"s
    // cost nothing to skip for a minute — so back off instead of re-timing-out.
    if (attempted > 0 && quoted === 0) arcusRetryAt = Date.now() + ARCUS_OUTAGE_BACKOFF_MS;
  }

  // Tier 3: the latest real market close — one cached Yahoo fetch covers all 95.
  // A real, slightly staler price beats a dash on a holding the user owns; the
  // asset page has always used this same series as its own fallback.
  const still = assets.filter((a) => filled[a.symbol]?.priceUsd === undefined);
  if (still.length > 0) {
    const summary = await getDaySummary().catch(() => ({}) as Record<string, { spark: number[] }>);
    for (const a of still) {
      const spark = summary[a.symbol]?.spark;
      const last = spark && spark.length > 0 ? spark[spark.length - 1] : undefined;
      if (last !== undefined && last > 0) {
        filled[a.symbol] = { symbol: a.symbol, priceUsd: last, source: "market" };
      }
    }
  }
  return filled;
}
