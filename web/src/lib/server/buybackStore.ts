import "server-only";

// $MONVERA buyback transparency — data layer.
//
// Revenue arrives as USDG into the treasury wallet; 20% of NET revenue (revenue
// minus expenses) is earmarked for buying back MONVERA. Buybacks are USDG->MONVERA
// swaps executed FROM the treasury, and the bought MONVERA is held IN the same
// treasury — so we index MONVERA inflows to the treasury (paired with a USDG
// outflow in the same tx) as buybacks, and store them in D1 (schema:
// migrations/0004_buyback.sql).
//
// Calculation (matches the disclosed policy):
//   totalRevenue = treasury USDG balance + total USDG spent on buybacks
//                  (buybacks are the only USDG outflow, so this reconstructs
//                   cumulative revenue even after we spend it)
//   netRevenue   = totalRevenue - totalExpenses           (expenses first)
//   buybackBudget = 20% * netRevenue                       (of net, cumulative)
//   availableToBuy = buybackBudget - totalSpentOnBuybacks
import { createPublicClient, http, parseAbiItem, getAddress, formatUnits, type Address } from "viem";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA } from "@/lib/monveraToken";
import { USDG } from "@/lib/tokens";

export const TREASURY = getAddress("0xb87f5A74267ca3F9512b8511B32cCd804EA3707E");
const BUYBACK_PCT = 0.2;

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BAL_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

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

// ── Indexer: record any new treasury buybacks (USDG out + MONVERA in) ──
const LAST_BLOCK_KEY = "buyback:lastblock:v1";
const INDEX_LOCK_KEY = "buyback:indexed:v1";
const CHUNK = BigInt(9000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const WINDOW = BigInt(20000);

/** Decode a treasury tx: sum USDG out of + MONVERA into the treasury. */
async function recordBuyFromTx(txHash: `0x${string}`): Promise<void> {
  const exists = await db().prepare("SELECT 1 FROM buybacks WHERE tx_hash=?").bind(txHash).first();
  if (exists) return;
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  let usdgOut = ZERO;
  let monveraIn = ZERO;
  for (const lg of receipt.logs) {
    if (lg.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || lg.topics.length < 3) continue;
    const from = getAddress(`0x${lg.topics[1]!.slice(26)}`);
    const to = getAddress(`0x${lg.topics[2]!.slice(26)}`);
    const val = BigInt(lg.data);
    if (getAddress(lg.address) === USDG.address && from === TREASURY) usdgOut += val;
    if (getAddress(lg.address) === MONVERA.address && to === TREASURY) monveraIn += val;
  }
  if (usdgOut === ZERO || monveraIn === ZERO) return; // not a buyback (no USDG spent for MONVERA)
  const usdgSpent = Number(formatUnits(usdgOut, USDG.decimals));
  const monveraAmount = Number(formatUnits(monveraIn, MONVERA.decimals));
  const price = monveraAmount > 0 ? usdgSpent / monveraAmount : 0;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  await db()
    .prepare("INSERT OR IGNORE INTO buybacks (tx_hash,block_number,bought_at,monvera_amount,usdg_spent,price_usd) VALUES (?,?,?,?,?,?)")
    .bind(txHash, Number(receipt.blockNumber), Number(block.timestamp), monveraAmount, usdgSpent, price)
    .run();
}

/** Scan for new MONVERA inflows to the treasury and record buybacks. Incremental
 *  via a KV block cursor; cheap when no buybacks occur (empty getLogs). */
export async function indexBuybacks(): Promise<void> {
  const store = kv();
  const latest = await client.getBlockNumber();
  const saved = store ? await store.get(LAST_BLOCK_KEY) : null;
  // First run: start from a recent window (the treasury has never sent a tx, so
  // no buyback can predate now — see nonce 0). Later runs resume from the cursor.
  let cursor = saved ? BigInt(saved) + ONE : latest > WINDOW ? latest - WINDOW : ZERO;
  if (cursor > latest) return;

  while (cursor <= latest) {
    const end = cursor + CHUNK - ONE < latest ? cursor + CHUNK - ONE : latest;
    let logs;
    try {
      logs = await client.getLogs({ address: MONVERA.address, event: TRANSFER, args: { to: TREASURY }, fromBlock: cursor, toBlock: end });
    } catch {
      break; // stop; resume from `cursor` next run
    }
    for (const log of logs) await recordBuyFromTx(log.transactionHash as `0x${string}`);
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
export async function getBuybackData(): Promise<{ stats: BuybackStats; buybacks: Buyback[]; expenses: Expense[] }> {
  const [treasuryUsdg, treasuryMonvera] = await Promise.all([
    balanceOf(USDG.address, USDG.decimals),
    balanceOf(MONVERA.address, MONVERA.decimals),
  ]);

  const bbRows = (
    await db()
      .prepare("SELECT tx_hash,block_number,bought_at,monvera_amount,usdg_spent,price_usd FROM buybacks ORDER BY bought_at DESC")
      .all<{ tx_hash: string; block_number: number; bought_at: number; monvera_amount: number; usdg_spent: number; price_usd: number }>()
  ).results;
  const exRows = (
    await db().prepare("SELECT id,spent_at,description,amount_usd FROM treasury_expenses ORDER BY spent_at DESC").all<{ id: number; spent_at: number; description: string; amount_usd: number }>()
  ).results;

  const buybacks: Buyback[] = bbRows.map((r) => ({
    txHash: r.tx_hash, blockNumber: r.block_number, boughtAt: r.bought_at,
    monveraAmount: r.monvera_amount, usdgSpent: r.usdg_spent, priceUsd: r.price_usd,
  }));
  const expenses: Expense[] = exRows.map((r) => ({ id: r.id, spentAt: r.spent_at, description: r.description, amountUsd: r.amount_usd }));

  const totalSpent = buybacks.reduce((s, b) => s + b.usdgSpent, 0);
  const totalBought = buybacks.reduce((s, b) => s + b.monveraAmount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amountUsd, 0);
  const totalRevenue = treasuryUsdg + totalSpent; // balance + spent = cumulative revenue
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
