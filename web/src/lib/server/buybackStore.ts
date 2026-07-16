import "server-only";

// $MONVERA buyback transparency — data layer.
//
// Revenue arrives as USDG into the treasury wallet; 20% of NET revenue (revenue
// minus expenses) is earmarked for buying back MONVERA. There is no deep direct
// USDG/MONVERA pool, so a buyback routes USDG -> VIRTUAL -> MONVERA over two v2
// pairs, and it lands as TWO separate treasury transactions:
//   1. FUNDING leg: USDG out of the treasury, VIRTUAL in    (USDG -> VIRTUAL)
//   2. BUYBACK leg: VIRTUAL out of the treasury, MONVERA in (VIRTUAL -> MONVERA)
// We index both. The BUYBACK leg carries no USDG, so its USD cost is derived
// from the treasury's weighted-average VIRTUAL cost basis (total USDG spent on
// VIRTUAL / total VIRTUAL acquired). A direct USDG->MONVERA buyback is still
// recognised too, for the day a direct pool exists.
//
// Calculation (matches the disclosed policy):
//   totalRevenue = treasury USDG balance + every USDG that has LEFT the treasury
//                  (buyback funding + any direct buyback) — reconstructs
//                  cumulative revenue even after we deploy it
//   netRevenue   = totalRevenue - totalExpenses            (expenses first)
//   buybackBudget = 20% * netRevenue                        (of net, cumulative)
//   totalSpent    = USD value of MONVERA actually bought    (cost-basis priced)
//   availableToBuy = buybackBudget - totalSpent
import { createPublicClient, http, parseAbiItem, getAddress, formatUnits, type Address } from "viem";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA, VIRTUAL } from "@/lib/monveraToken";
import { USDG } from "@/lib/tokens";

export const TREASURY = getAddress("0xb87f5A74267ca3F9512b8511B32cCd804EA3707E");
const BUYBACK_PCT = 0.2;

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL, { retryCount: 1, timeout: 8_000 }) });
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BAL_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// Checksummed token addresses for cheap equality against decoded log addresses.
const MONVERA_ADDR = getAddress(MONVERA.address);
const VIRTUAL_ADDR = getAddress(VIRTUAL.address);
const USDG_ADDR = getAddress(USDG.address);

// ── D1 + KV plumbing (mirrors autopilotStore / wrapperMap) ──
interface D1Result<T> { results: T[]; }
interface D1Stmt { bind(...v: unknown[]): D1Stmt; run<T = unknown>(): Promise<D1Result<T>>; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<D1Result<T>>; }
interface D1Db { prepare(sql: string): D1Stmt; }
function db(): D1Db {
  const env = getCloudflareContext().env as { DB?: D1Db };
  if (!env.DB) throw new Error("D1 binding DB is not configured.");
  return env.DB;
}
interface KvNs { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>; }
function kv(): KvNs | null {
  try { return (getCloudflareContext().env as { KV?: KvNs }).KV ?? null; } catch { return null; }
}

export interface Buyback { txHash: string; blockNumber: number; boughtAt: number; monveraAmount: number; usdgSpent: number; priceUsd: number; }
export interface Expense { id: number; spentAt: number; description: string; amountUsd: number; }
export interface BuybackStats {
  treasury: string;
  treasuryUsdg: number;
  treasuryMonvera: number;
  totalRevenue: number;
  totalExpenses: number;
  netRevenue: number;
  buybackPct: number;
  buybackBudget: number;
  totalBought: number;
  totalSpent: number;
  avgPrice: number | null;
  availableToBuy: number;
  budgetDeployedPct: number;
  buybackCount: number;
  asOf: string;
}

async function balanceOf(token: Address, decimals: number): Promise<number> {
  try {
    const raw = (await client.readContract({ address: token, abi: BAL_ABI, functionName: "balanceOf", args: [TREASURY] })) as bigint;
    return Number(formatUnits(raw, decimals));
  } catch {
    return 0;
  }
}

// ── Indexer: record new treasury funding (USDG->VIRTUAL) and buyback legs ──
const LAST_BLOCK_KEY = "buyback:lastblock:v1";
const INDEX_LOCK_KEY = "buyback:indexed:v1";
// The RPC serves topic-filtered getLogs over 500k+ block ranges in one call
// (verified live); tiny chunks made the cursor crawl ~9k blocks per run and lag
// the chain head by days. Keep a chunk cap only as a safety valve.
const CHUNK = BigInt(400_000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const WINDOW = BigInt(20000);
// How far back a relayed fill may look for its USDG funding outflow.
const RELAY_LOOKBACK = BigInt(2000);

/** The nearest prior USDG outflow from the treasury (within RELAY_LOOKBACK
 *  blocks) that hasn't already been consumed by another record — the funding
 *  side of a relayed buyback. */
async function findFundingOutflow(fillBlock: bigint): Promise<{ txHash: string; usdgSpent: number } | null> {
  const from = fillBlock > RELAY_LOOKBACK ? fillBlock - RELAY_LOOKBACK : ZERO;
  let logs;
  try {
    logs = await client.getLogs({ address: USDG.address, event: TRANSFER, args: { from: TREASURY }, fromBlock: from, toBlock: fillBlock });
  } catch {
    return null;
  }
  // Newest-first: the funding tx is typically seconds before the fill.
  logs.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  for (const lg of logs) {
    const h = lg.transactionHash as string;
    const used = await db()
      .prepare(
        "SELECT 1 AS x FROM buybacks WHERE tx_hash=? OR source_tx=? UNION ALL SELECT 1 FROM treasury_funding WHERE tx_hash=?",
      )
      .bind(h, h, h)
      .first();
    if (used) continue;
    const amount = (lg.args as { value?: bigint }).value ?? ZERO;
    if (amount === ZERO) continue;
    return { txHash: h, usdgSpent: Number(formatUnits(amount, USDG.decimals)) };
  }
  return null;
}

/** Classify one treasury tx by its Transfer logs and record it if it is a
 *  funding leg, a routed buyback, a direct buyback, or a relayed fill.
 *  Idempotent per tx. */
async function classifyTx(txHash: `0x${string}`): Promise<void> {
  const seen = await db()
    .prepare("SELECT 1 AS x FROM buybacks WHERE tx_hash=? UNION ALL SELECT 1 FROM treasury_funding WHERE tx_hash=?")
    .bind(txHash, txHash)
    .first();
  if (seen) return;

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  let usdgOut = ZERO;
  let virtualIn = ZERO;
  let virtualOut = ZERO;
  let monveraIn = ZERO;
  for (const lg of receipt.logs) {
    if (lg.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || lg.topics.length < 3) continue;
    const from = getAddress(`0x${lg.topics[1]!.slice(26)}`);
    const to = getAddress(`0x${lg.topics[2]!.slice(26)}`);
    const val = BigInt(lg.data);
    const token = getAddress(lg.address);
    if (token === USDG_ADDR && from === TREASURY) usdgOut += val;
    if (token === VIRTUAL_ADDR && to === TREASURY) virtualIn += val;
    if (token === VIRTUAL_ADDR && from === TREASURY) virtualOut += val;
    if (token === MONVERA_ADDR && to === TREASURY) monveraIn += val;
  }

  const blockNumber = Number(receipt.blockNumber);
  const at = Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  const monveraAmount = Number(formatUnits(monveraIn, MONVERA.decimals));

  // Routed buyback: VIRTUAL out + MONVERA in (the common path).
  if (virtualOut > ZERO && monveraIn > ZERO) {
    const virtualSpent = Number(formatUnits(virtualOut, VIRTUAL.decimals));
    await db()
      .prepare("INSERT OR IGNORE INTO buybacks (tx_hash,block_number,bought_at,monvera_amount,usdg_spent,virtual_spent,price_usd) VALUES (?,?,?,?,?,?,?)")
      .bind(txHash, blockNumber, at, monveraAmount, 0, virtualSpent, 0)
      .run();
    return;
  }
  // Direct buyback: USDG out + MONVERA in within one tx.
  if (usdgOut > ZERO && monveraIn > ZERO) {
    const usdgSpent = Number(formatUnits(usdgOut, USDG.decimals));
    const price = monveraAmount > 0 ? usdgSpent / monveraAmount : 0;
    await db()
      .prepare("INSERT OR IGNORE INTO buybacks (tx_hash,block_number,bought_at,monvera_amount,usdg_spent,virtual_spent,price_usd) VALUES (?,?,?,?,?,?,?)")
      .bind(txHash, blockNumber, at, monveraAmount, usdgSpent, 0, price)
      .run();
    return;
  }
  // Relayed buyback: MONVERA arrives with no treasury outflow in the SAME tx —
  // the USDG left in an earlier tx and a relay delivered the fill (the permit+
  // relay route). Pair the fill with the nearest prior unconsumed USDG outflow.
  if (monveraIn > ZERO && usdgOut === ZERO && virtualOut === ZERO) {
    const fundedBy = await findFundingOutflow(receipt.blockNumber);
    const usdgSpent = fundedBy?.usdgSpent ?? 0;
    const price = usdgSpent > 0 && monveraAmount > 0 ? usdgSpent / monveraAmount : 0;
    await db()
      .prepare("INSERT OR IGNORE INTO buybacks (tx_hash,block_number,bought_at,monvera_amount,usdg_spent,virtual_spent,price_usd,source_tx) VALUES (?,?,?,?,?,?,?,?)")
      .bind(txHash, blockNumber, at, monveraAmount, usdgSpent, 0, price, fundedBy?.txHash ?? null)
      .run();
    return;
  }
  // Funding leg: USDG out + VIRTUAL in, no MONVERA yet.
  if (usdgOut > ZERO && virtualIn > ZERO) {
    const usdgSpent = Number(formatUnits(usdgOut, USDG.decimals));
    const virtualBought = Number(formatUnits(virtualIn, VIRTUAL.decimals));
    await db()
      .prepare("INSERT OR IGNORE INTO treasury_funding (tx_hash,block_number,funded_at,usdg_spent,virtual_bought) VALUES (?,?,?,?,?)")
      .bind(txHash, blockNumber, at, usdgSpent, virtualBought)
      .run();
  }
}

/** Scan for new VIRTUAL and MONVERA inflows to the treasury and record the funding
 *  and buyback legs behind them. Incremental via a KV block cursor; cheap when
 *  nothing happens (empty getLogs). */
export async function indexBuybacks(): Promise<void> {
  const store = kv();
  const latest = await client.getBlockNumber();
  const saved = store ? await store.get(LAST_BLOCK_KEY) : null;
  // First run: start from a recent window (the treasury sent its first tx only on
  // 2026-07-16, so nothing older can be a buyback). Later runs resume from cursor.
  let cursor = saved ? BigInt(saved) + ONE : latest > WINDOW ? latest - WINDOW : ZERO;
  if (cursor > latest) return;

  while (cursor <= latest) {
    const end = cursor + CHUNK - ONE < latest ? cursor + CHUNK - ONE : latest;
    let hashes: Set<string>;
    try {
      // Funding legs land VIRTUAL in the treasury; buyback legs land MONVERA.
      const [virtLogs, monLogs] = await Promise.all([
        client.getLogs({ address: VIRTUAL.address, event: TRANSFER, args: { to: TREASURY }, fromBlock: cursor, toBlock: end }),
        client.getLogs({ address: MONVERA.address, event: TRANSFER, args: { to: TREASURY }, fromBlock: cursor, toBlock: end }),
      ]);
      hashes = new Set([...virtLogs, ...monLogs].map((l) => l.transactionHash as string));
    } catch {
      break; // stop; resume from `cursor` next run
    }
    for (const h of hashes) await classifyTx(h as `0x${string}`);
    cursor = end + ONE;
  }
  if (store) await store.put(LAST_BLOCK_KEY, (cursor - ONE).toString());
}

/** Run the indexer at most once per ~2 minutes (KV throttle), so dashboard loads
 *  stay fast and we don't hammer the RPC. */
export async function maybeIndex(): Promise<void> {
  const store = kv();
  if (store) {
    const last = await store.get(INDEX_LOCK_KEY);
    if (last && Date.now() - Number(last) < 120_000) return;
    await store.put(INDEX_LOCK_KEY, String(Date.now()), { expirationTtl: 600 });
  }
  await indexBuybacks();
}

// ── Read: stats + lists ──
interface BuybackRow { tx_hash: string; block_number: number; bought_at: number; monvera_amount: number; usdg_spent: number; virtual_spent: number; price_usd: number; }
interface ExpenseRow { id: number; spent_at: number; description: string; amount_usd: number; }
interface FundingRow { usdg_spent: number; virtual_bought: number; }

export async function getBuybackData(): Promise<{ stats: BuybackStats; buybacks: Buyback[]; expenses: Expense[] }> {
  const [treasuryUsdg, treasuryMonvera] = await Promise.all([
    balanceOf(USDG.address, USDG.decimals),
    balanceOf(MONVERA.address, MONVERA.decimals),
  ]);

  let bbRows: BuybackRow[] = [];
  let exRows: ExpenseRow[] = [];
  let fundRows: FundingRow[] = [];
  try {
    bbRows = (
      await db()
        .prepare("SELECT tx_hash,block_number,bought_at,monvera_amount,usdg_spent,virtual_spent,price_usd FROM buybacks ORDER BY bought_at DESC")
        .all<BuybackRow>()
    ).results;
    exRows = (await db().prepare("SELECT id,spent_at,description,amount_usd FROM treasury_expenses ORDER BY spent_at DESC").all<ExpenseRow>()).results;
    fundRows = (await db().prepare("SELECT usdg_spent,virtual_bought FROM treasury_funding").all<FundingRow>()).results;
  } catch {
    /* D1 not ready — render with on-chain figures only rather than 500 */
  }

  // Treasury's weighted-average VIRTUAL cost basis (USDG per VIRTUAL), used to
  // price each routed buyback back into dollars.
  const totalUsdgFunding = fundRows.reduce((s, r) => s + r.usdg_spent, 0);
  const totalVirtualBought = fundRows.reduce((s, r) => s + r.virtual_bought, 0);
  const costBasis = totalVirtualBought > 0 ? totalUsdgFunding / totalVirtualBought : 0;

  const buybacks: Buyback[] = bbRows.map((r) => {
    const usdgSpent = r.virtual_spent > 0 ? r.virtual_spent * costBasis : r.usdg_spent;
    const priceUsd = r.monvera_amount > 0 ? usdgSpent / r.monvera_amount : 0;
    return { txHash: r.tx_hash, blockNumber: r.block_number, boughtAt: r.bought_at, monveraAmount: r.monvera_amount, usdgSpent, priceUsd };
  });
  const expenses: Expense[] = exRows.map((r) => ({ id: r.id, spentAt: r.spent_at, description: r.description, amountUsd: r.amount_usd }));

  const totalBought = buybacks.reduce((s, b) => s + b.monveraAmount, 0);
  const totalSpent = buybacks.reduce((s, b) => s + b.usdgSpent, 0); // USD value deployed into MONVERA
  // Every USDG that has left the treasury did so via a funding leg or a direct buyback.
  const directUsdgSpent = bbRows.reduce((s, r) => s + (r.virtual_spent > 0 ? 0 : r.usdg_spent), 0);
  const totalUsdgOut = totalUsdgFunding + directUsdgSpent;
  const totalExpenses = expenses.reduce((s, e) => s + e.amountUsd, 0);
  const totalRevenue = treasuryUsdg + totalUsdgOut; // balance + spent = cumulative revenue
  const netRevenue = Math.max(0, totalRevenue - totalExpenses);
  const buybackBudget = netRevenue * BUYBACK_PCT;
  const avgPrice = totalBought > 0 ? totalSpent / totalBought : null;
  const availableToBuy = Math.max(0, buybackBudget - totalSpent);
  const budgetDeployedPct = buybackBudget > 0 ? Math.min(100, (totalSpent / buybackBudget) * 100) : 0;

  const stats: BuybackStats = {
    treasury: TREASURY,
    treasuryUsdg, treasuryMonvera,
    totalRevenue, totalExpenses, netRevenue,
    buybackPct: BUYBACK_PCT, buybackBudget,
    totalBought, totalSpent, avgPrice,
    availableToBuy, budgetDeployedPct,
    buybackCount: buybacks.length,
    asOf: new Date().toISOString(),
  };
  return { stats, buybacks, expenses };
}
