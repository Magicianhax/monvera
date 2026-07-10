// Live USD spot pricing for every asset, from each token's Chainlink price feed.
//
// Robinhood stock tokens have no AMM, so pricing comes from per-asset Chainlink
// AggregatorV3 feeds (latestRoundData). The feed value is already corporate-action
// adjusted (splits/dividends), so it's the token's full USD price — we do NOT
// apply the ERC-8056 uiMultiplier on top. Feeds use 8 decimals.
//
// Reads batch through the caller's Multicall3-enabled client, so ~95 feed reads
// fold into one eth_call. Assets with no feed yet (roughly half the universe
// on this new chain) return undefined, surfaced honestly by callers rather
// than faked — trading still quotes live through Arcus.
import type { Abi, PublicClient } from "viem";
import { ALL_ASSETS, type Asset } from "./tokens";

const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const satisfies Abi;

const FEED_DECIMALS = 8; // all Robinhood Chain equity/ETF feeds use 8 decimals
// Equity feeds only tick while the market trades. A holiday long weekend is the
// longest legitimate gap (Thu close -> Mon open ≈ 89h), so the staleness gate
// must sit above that or every position values to $0 all weekend.
const MAX_STALENESS_SECONDS = 4.5 * 86400;

export interface AssetPrice {
  symbol: string;
  /** USD per whole token, or undefined if the asset has no live feed / stale price. */
  priceUsd?: number;
  /** Where the price came from (for honesty in the UI / debugging). */
  source: "chainlink" | "arcus" | "market" | "none";
}

/** Price a single asset from its Chainlink feed. Best-effort; undefined when no live source. */
export async function priceAsset(
  client: PublicClient,
  asset: Asset,
  nowSeconds: number,
): Promise<AssetPrice> {
  if (!asset.feed) return { symbol: asset.symbol, priceUsd: undefined, source: "none" };
  try {
    const [, answer, , updatedAt] = await client.readContract({
      address: asset.feed,
      abi: AGGREGATOR_V3_ABI,
      functionName: "latestRoundData",
    });
    if (answer <= BigInt(0) || updatedAt === BigInt(0)) {
      return { symbol: asset.symbol, priceUsd: undefined, source: "none" };
    }
    if (nowSeconds - Number(updatedAt) > MAX_STALENESS_SECONDS) {
      return { symbol: asset.symbol, priceUsd: undefined, source: "none" };
    }
    return {
      symbol: asset.symbol,
      priceUsd: Number(answer) / 10 ** FEED_DECIMALS,
      source: "chainlink",
    };
  } catch {
    return { symbol: asset.symbol, priceUsd: undefined, source: "none" };
  }
}

/** Price every asset in the universe (or a subset). Returns a symbol->price map. */
export async function priceAll(
  client: PublicClient,
  assets: Asset[] = ALL_ASSETS,
): Promise<Record<string, AssetPrice>> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const results = await Promise.all(assets.map((a) => priceAsset(client, a, nowSeconds)));
  const map: Record<string, AssetPrice> = {};
  for (const r of results) map[r.symbol] = r;
  return map;
}
