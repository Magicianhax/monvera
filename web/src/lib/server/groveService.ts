import "server-only";

// Live layer for Groves — assembles everything the registry (lib/groves) can't
// know at build time: current per-component prices, a 1-year backtest vs SPY,
// and the public stats the GroveManager contract emits once deployed.
//
// Until NEXT_PUBLIC_GROVE_MANAGER / GROVE_MANAGER_ADDRESS is set, stats are
// honest zeros with deployed:false — the pages ship in preview mode and the UI
// says "opens soon" instead of pretending. Prices come through the same
// priceAllWithFallback tiers every other surface uses (Chainlink → Arcus →
// market close), so a grove page can never disagree with the market list.
import { createPublicClient, http, type Address } from "viem";
import { GROVES, groveById, type GroveComponent, type GroveDef } from "@/lib/groves";
import { assetBySymbol, MULTICALL3, type Asset } from "@/lib/tokens";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "./rpc";
import { priceAllWithFallback } from "./pricing";
import { backtestBasket, type BacktestResult } from "./quant";

// batch.multicall folds the per-component feed reads into one eth_call, same as
// /api/prices — without it the RPC rate-limits the tail of a cold burst.
const publicClient = createPublicClient({
  chain: {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls,
    contracts: { multicall3: { address: MULTICALL3 } },
  },
  batch: { multicall: { wait: 16 } },
  transport: http(SERVER_RPC_URL),
});

// ── on-chain stats ───────────────────────────────────────────────────────────

export interface GroveStats {
  /** False while the GroveManager contract is not deployed (preview mode). */
  deployed: boolean;
  /** Users with an open position (activeUserCount). */
  users: number;
  /** Open cost basis across all users, USD (totalCostBasisUsdg, 6dp). */
  managedUsd: number;
  /** Cumulative exit fees collected, USD (cumulativeFeesUsdg, 6dp). */
  feesUsd: number;
}

const PREVIEW_STATS: GroveStats = { deployed: false, users: 0, managedUsd: 0, feesUsd: 0 };

// GroveManager address — unset means the contract is not deployed yet and every
// grove reports preview stats. Setting the env is the ONLY wiring needed.
const GROVE_MANAGER = (process.env.NEXT_PUBLIC_GROVE_MANAGER ||
  process.env.GROVE_MANAGER_ADDRESS ||
  "") as Address | "";

// ---- contract-reading branch (STUB until deploy; view/event names are real) --
// GroveManager.sol (stax/contracts): `groves(uint256)` is the public mapping
// getter returning (name, feeBps, version, activeUserCount, totalCostBasisUsdg,
// cumulativeInflowUsdg, cumulativeProceedsUsdg, cumulativeFeesUsdg). Indexers
// can follow the events: GroveCreated, Bought, Exited, Rebalanced,
// CompositionUpdated, PositionClosed.
//
// The groveId comes from each grove's explicit `onChainId`, never from its
// position in GROVES. Position only *looks* like the id, and reading the wrong
// slot would render one basket's users and cost basis under another's name.
const GROVE_MANAGER_ABI = [
  {
    type: "function",
    name: "groves",
    stateMutability: "view",
    inputs: [{ name: "groveId", type: "uint256" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "feeBps", type: "uint16" },
      { name: "version", type: "uint32" },
      { name: "activeUserCount", type: "uint256" },
      { name: "totalCostBasisUsdg", type: "uint256" },
      { name: "cumulativeInflowUsdg", type: "uint256" },
      { name: "cumulativeProceedsUsdg", type: "uint256" },
      { name: "cumulativeFeesUsdg", type: "uint256" },
    ],
  },
] as const;

const USDG_PER_USD = 1e6; // USDG is 6dp

async function readGroveStats(def: GroveDef): Promise<GroveStats> {
  // No contract, or this grove was never created on-chain — preview either way.
  if (!GROVE_MANAGER || def.onChainId === undefined) return PREVIEW_STATS;
  try {
    const [, , , activeUserCount, totalCostBasisUsdg, , , cumulativeFeesUsdg] =
      await publicClient.readContract({
        address: GROVE_MANAGER,
        abi: GROVE_MANAGER_ABI,
        functionName: "groves",
        args: [BigInt(def.onChainId)],
      });
    return {
      deployed: true,
      users: Number(activeUserCount),
      managedUsd: Number(totalCostBasisUsdg) / USDG_PER_USD,
      feesUsd: Number(cumulativeFeesUsdg) / USDG_PER_USD,
    };
  } catch {
    // An RPC hiccup must not fake live zeros as real numbers — fall back to the
    // preview shape so the UI shows its pending state, never a wrong figure.
    return PREVIEW_STATS;
  }
}

// ── assembled payload ────────────────────────────────────────────────────────

export interface GroveComponentLive extends GroveComponent {
  /** Company name from the token registry. */
  name: string;
  /** Live USD price, or null when no source can price it right now. */
  priceUsd: number | null;
}

export interface GroveLive extends Omit<GroveDef, "components"> {
  components: GroveComponentLive[];
  stats: GroveStats;
  /** 1Y walk vs buy-and-hold SPY (lib/server/quant). History, not a promise. */
  backtest: BacktestResult | null;
  asOf: string;
}

export interface GrovesPayload {
  asOf: string;
  note: string;
  groves: GroveLive[];
}

// Backtests recompute from 6h-cached histories; cache the result per grove for
// the same window so a page burst never pays the simulation twice.
const BACKTEST_TTL_MS = 6 * 60 * 60_000;
const backtestCache = new Map<string, { at: number; value: Promise<BacktestResult | null> }>();

function groveBacktest(def: GroveDef): Promise<BacktestResult | null> {
  const hit = backtestCache.get(def.id);
  if (hit && Date.now() - hit.at < BACKTEST_TTL_MS) return hit.value;
  const value = backtestBasket(
    def.components.map((c) => ({ symbol: c.symbol, weightPct: c.weightBps / 100 })),
  ).catch(() => {
    backtestCache.delete(def.id);
    return null; // a data hiccup never hides the grove itself
  });
  backtestCache.set(def.id, { at: Date.now(), value });
  return value;
}

async function assemble(defs: GroveDef[]): Promise<GroveLive[]> {
  // One price sweep covers every component across the requested groves.
  const assets = new Map<string, Asset>();
  for (const def of defs) {
    for (const c of def.components) {
      const a = assetBySymbol(c.symbol);
      if (a) assets.set(a.symbol, a);
    }
  }
  const prices = await priceAllWithFallback(publicClient, [...assets.values()]).catch(
    () => ({}) as Awaited<ReturnType<typeof priceAllWithFallback>>,
  );

  return Promise.all(
    defs.map(async (def) => {
      const [stats, backtest] = await Promise.all([readGroveStats(def), groveBacktest(def)]);
      return {
        ...def,
        components: def.components.map((c) => ({
          ...c,
          name: assetBySymbol(c.symbol)?.name ?? c.symbol,
          priceUsd: prices[c.symbol]?.priceUsd ?? null,
        })),
        stats,
        backtest,
        asOf: new Date().toISOString(),
      };
    }),
  );
}

const NOTE =
  "A Grove is a strategy, not a fund: the basket is bought into your own wallet, non-custodial. $0 entry, $0 management, $0 rebalance — the only fee is 10% of profit when you exit, against your own cost basis. Backtests are history, not promises.";

// Short assembled-payload cache so a burst of viewers shares one build; the
// edge cache on the route carries the rest.
const PAYLOAD_TTL_MS = 60_000;
let payloadCache: { at: number; value: Promise<GrovesPayload> } | null = null;

/** All groves with live prices, stats, and backtests (cached ~60s). */
export function getGroves(): Promise<GrovesPayload> {
  if (payloadCache && Date.now() - payloadCache.at < PAYLOAD_TTL_MS) return payloadCache.value;
  const value = assemble(GROVES)
    // Launched groves lead the shelf everywhere (public page, /api, in-app):
    // Titan is live and buyable, the rest are previews. Stable sort, so the
    // registry's order still decides within each group. Display-only — chain
    // scripts key on onChainId, never on list position.
    .then((groves) => groves.slice().sort((a, b) => Number(b.stats.deployed) - Number(a.stats.deployed)))
    .then((groves) => ({ asOf: new Date().toISOString(), note: NOTE, groves }))
    .catch((err) => {
      payloadCache = null;
      throw err;
    });
  payloadCache = { at: Date.now(), value };
  return value;
}

/** One grove with live data, or null when the id isn't in the registry. */
export async function getGrove(id: string): Promise<GroveLive | null> {
  const def = groveById(id);
  if (!def) return null;
  // Serve from the shared list build when warm — the detail page and the list
  // must never show different numbers for the same grove.
  if (payloadCache && Date.now() - payloadCache.at < PAYLOAD_TTL_MS) {
    const payload = await payloadCache.value.catch(() => null);
    const hit = payload?.groves.find((g) => g.id === id);
    if (hit) return hit;
  }
  const [live] = await assemble([def]);
  return live;
}
