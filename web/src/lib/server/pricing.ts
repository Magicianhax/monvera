import "server-only";

// One place that answers "what is this asset worth right now".
//
// Only ~a third of the universe has a Chainlink feed on this young chain, so
// priceAll() alone leaves most stocks unpriced — they rendered a bare "—" in
// holdings, on the sell sheet, and in price alerts, even for positions the user
// holds. Arcus quotes every tradable asset, so we fill the gaps from an
// indicative quote. Assets neither source can price stay honestly unpriced.
//
// Every server caller (prices, portfolio, alerts) must go through here; calling
// priceAll() directly is what let holdings and the market list disagree.
import type { PublicClient } from "viem";
import { ALL_ASSETS, type Asset } from "@/lib/tokens";
import { priceAll, type AssetPrice } from "@/lib/prices";
import { arcusPriceUsd } from "@/lib/server/arcus";

// Small batches: a cold cache would otherwise fire ~60 quotes at once and the
// router rate-limits per IP — which every user of ours shares.
const ARCUS_BATCH = 6;
// A cold cache must never hold the page hostage. We spend a small budget filling
// what we can, and whatever we don't reach stays unpriced for THIS response and
// is picked up by the next one (the client refetches every 30s, and each token's
// price is cached for 5 min). Prices converge within a refresh or two; a bounded
// response beats a complete one, because the alternative is an app that hangs.
const ARCUS_BUDGET_MS = 2_000;

export async function priceAllWithFallback(
  client: PublicClient,
  assets: Asset[] = ALL_ASSETS,
): Promise<Record<string, AssetPrice>> {
  const chainlink = await priceAll(client, assets);
  const missing = assets.filter((a) => chainlink[a.symbol]?.priceUsd === undefined);
  if (missing.length === 0) return chainlink;

  const deadline = Date.now() + ARCUS_BUDGET_MS;
  const filled: Record<string, AssetPrice> = { ...chainlink };
  for (let i = 0; i < missing.length; i += ARCUS_BATCH) {
    if (Date.now() > deadline) break;
    const batch = missing.slice(i, i + ARCUS_BATCH);
    const priced = await Promise.all(
      batch.map(async (a) => [a.symbol, await arcusPriceUsd(a.address, a.decimals)] as const),
    );
    for (const [symbol, priceUsd] of priced) {
      if (priceUsd !== undefined) filled[symbol] = { symbol, priceUsd, source: "arcus" };
    }
  }
  return filled;
}
