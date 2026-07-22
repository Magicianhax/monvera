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
import { chain, RPC_URL } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA, VIRTUAL } from "@/lib/monveraToken";
import { USDG } from "@/lib/tokens";

export const TREASURY = getAddress("0xb87f5A74267ca3F9512b8511B32cCd804EA3707E");
const BUYBACK_PCT = 0.2;

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL, { retryCount: 1, timeout: 8_000 }) });
// Wide log scans go to the PUBLIC RPC, not the keyed one. Alchemy's free tier
// caps eth_getLogs at a 10-BLOCK range ("Upgrade to PAYG for expanded block
// range"), which silently wedged this indexer: every catch-up failed on its
// first chunk, so the cursor never moved and four buybacks went unrecorded.
// The public RPC serves topic-filtered scans over millions of blocks in well
// under a second (measured: 2M blocks in ~640ms). Point reads (receipts,
// blocks, balances) stay on `client`, which Alchemy handles fine.
const logsClient = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 1, timeout: 20_000 }) });
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
// The RPC serves topic-filtered getLogs over multi-million block ranges in one
// call (verified live at 4.9M), so the chunk is a safety valve, not a crawl.
const CHUNK = BigInt(2_000_000);
// Bounded work per invocation. This runs inside a request on a Worker, so a
// long catch-up gets killed part-way; we stop early and on purpose instead,
// having already persisted progress, and the next run continues.
const MAX_CHUNKS_PER_RUN = 8;
const RUN_BUDGET_MS = 20_000;
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
    logs = await logsClient.getLogs({ address: USDG.address, event: TRANSFER, args: { from: TREASURY }, fromBlock: from, toBlock: fillBlock });
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

// ── Zerion: the treasury's decoded transaction history ──────────────────────
// Zerion indexes Robinhood Chain as `robinhood` (external_id 0x1237 = 4663) and
// returns DECODED transfers, so this path needs no block cursor, no chunking and
// no per-tx receipt fetch — the three things that made the RPC path fragile.
// The RPC scanner below stays as the fallback.

const ZERION_KEY = process.env.ZERION_API_KEY;
const ZERION_CHAIN = "robinhood";
const ZERION_PAGE_SIZE = 100;
const ZERION_MAX_PAGES = 5;

interface ZTransfer {
  direction?: string;
  quantity?: { float?: number };
  fungible_info?: { implementations?: { chain_id?: string; address?: string }[] };
}
interface ZTx {
  attributes?: { hash?: string; mined_at_block?: number; mined_at?: string; status?: string; transfers?: ZTransfer[] };
}

/** One treasury tx reduced to the four movements the buyback ledger cares about. */
interface TreasuryTx {
  hash: `0x${string}`;
  blockNumber: number;
  at: number;
  usdgOut: number;
  virtualIn: number;
  virtualOut: number;
  monveraIn: number;
}

const lc = (a: string) => a.toLowerCase();
const USDG_LC = lc(USDG.address);
const VIRTUAL_LC = lc(VIRTUAL.address);
const MONVERA_LC = lc(MONVERA.address);

/** Treasury history from Zerion, newest first. */
async function zerionTreasuryTxs(): Promise<TreasuryTx[]> {
  let url =
    `https://api.zerion.io/v1/wallets/${TREASURY}/transactions/` +
    `?filter%5Bchain_ids%5D=${ZERION_CHAIN}&page%5Bsize%5D=${ZERION_PAGE_SIZE}`;
  const out: TreasuryTx[] = [];

  for (let page = 0; page < ZERION_MAX_PAGES && url; page++) {
    const res = await fetch(url, {
      headers: { accept: "application/json", authorization: `Basic ${btoa(`${ZERION_KEY}:`)}` },
    });
    if (!res.ok) throw new Error(`zerion ${res.status}`);
    const json = (await res.json()) as { data?: ZTx[]; links?: { next?: string } };

    for (const tx of json.data ?? []) {
      const a = tx.attributes;
      // A reverted tx moved nothing; recording it would invent a buyback.
      if (!a?.hash || a.status !== "confirmed") continue;
      const t: TreasuryTx = {
        hash: a.hash as `0x${string}`,
        blockNumber: a.mined_at_block ?? 0,
        at: a.mined_at ? Math.floor(Date.parse(a.mined_at) / 1000) : 0,
        usdgOut: 0, virtualIn: 0, virtualOut: 0, monveraIn: 0,
      };
      for (const tr of a.transfers ?? []) {
        const addr = lc(tr.fungible_info?.implementations?.find((i) => i.chain_id === ZERION_CHAIN)?.address ?? "");
        const amt = typeof tr.quantity?.float === "number" ? tr.quantity.float : 0;
        const outbound = tr.direction === "out";
        if (addr === USDG_LC && outbound) t.usdgOut += amt;
        else if (addr === VIRTUAL_LC) { if (outbound) t.virtualOut += amt; else t.virtualIn += amt; }
        else if (addr === MONVERA_LC && !outbound) t.monveraIn += amt;
      }
      out.push(t);
    }
    url = json.links?.next ?? "";
  }
  return out;
}

/** Every tx hash already recorded, including the funding legs consumed by a
 *  relayed fill (`source_tx`). Loaded once per run so classification costs one
 *  D1 read instead of one per transaction. */
async function loadKnownHashes(): Promise<Set<string>> {
  const rows = (
    await db()
      .prepare(
        "SELECT tx_hash AS h FROM buybacks UNION SELECT source_tx AS h FROM buybacks WHERE source_tx IS NOT NULL UNION SELECT tx_hash AS h FROM treasury_funding",
      )
      .all<{ h: string }>()
  ).results;
  return new Set(rows.map((r) => lc(r.h)));
}

/** Record one treasury tx using pre-decoded amounts. Mirrors classifyTx's
 *  branches exactly; `all` supplies the funding leg for a relayed fill. */
async function recordTreasuryTx(t: TreasuryTx, all: TreasuryTx[], known: Set<string>): Promise<void> {
  if (known.has(lc(t.hash))) return;

  const insertBuyback = async (usdgSpent: number, virtualSpent: number, sourceTx: string | null) => {
    const price = usdgSpent > 0 && t.monveraIn > 0 ? usdgSpent / t.monveraIn : 0;
    await db()
      .prepare("INSERT OR IGNORE INTO buybacks (tx_hash,block_number,bought_at,monvera_amount,usdg_spent,virtual_spent,price_usd,source_tx) VALUES (?,?,?,?,?,?,?,?)")
      .bind(t.hash, t.blockNumber, t.at, t.monveraIn, usdgSpent, virtualSpent, price, sourceTx)
      .run();
    known.add(lc(t.hash));
    if (sourceTx) known.add(lc(sourceTx));
  };

  // Routed buyback: VIRTUAL out + MONVERA in. Priced later off the cost basis.
  if (t.virtualOut > 0 && t.monveraIn > 0) return insertBuyback(0, t.virtualOut, null);
  // Direct buyback: USDG out + MONVERA in within one tx.
  if (t.usdgOut > 0 && t.monveraIn > 0) return insertBuyback(t.usdgOut, 0, null);
  // Relayed fill: MONVERA arrives with no treasury outflow in the same tx. Pair
  // it with the nearest prior unconsumed USDG outflow (the funding tx).
  if (t.monveraIn > 0 && t.usdgOut === 0 && t.virtualOut === 0) {
    const lookback = Number(RELAY_LOOKBACK);
    const funding = all
      .filter((x) => x.usdgOut > 0 && x.blockNumber <= t.blockNumber && x.blockNumber >= t.blockNumber - lookback && !known.has(lc(x.hash)))
      .sort((a, b) => b.blockNumber - a.blockNumber)[0];
    return insertBuyback(funding?.usdgOut ?? 0, 0, funding?.hash ?? null);
  }
  // Funding leg: USDG out + VIRTUAL in, no MONVERA yet.
  if (t.usdgOut > 0 && t.virtualIn > 0) {
    await db()
      .prepare("INSERT OR IGNORE INTO treasury_funding (tx_hash,block_number,funded_at,usdg_spent,virtual_bought) VALUES (?,?,?,?,?)")
      .bind(t.hash, t.blockNumber, t.at, t.usdgOut, t.virtualIn)
      .run();
    known.add(lc(t.hash));
  }
}

async function indexViaZerion(): Promise<void> {
  const txs = await zerionTreasuryTxs();
  const known = await loadKnownHashes();
  // Oldest first: a relayed fill must see the funding leg that preceded it, and
  // funding must be marked consumed before a later fill can claim it.
  const ordered = [...txs].sort((a, b) => a.blockNumber - b.blockNumber);
  for (const t of ordered) {
    try {
      await recordTreasuryTx(t, ordered, known);
    } catch (err) {
      console.error("[buyback] zerion record failed", { tx: t.hash, err });
    }
  }
}

/** Scan for new VIRTUAL and MONVERA inflows to the treasury and record the funding
 *  and buyback legs behind them. Incremental via a KV block cursor; cheap when
 *  nothing happens (empty getLogs). */
async function indexViaRpc(): Promise<void> {
  const store = kv();
  const latest = await client.getBlockNumber();
  const saved = store ? await store.get(LAST_BLOCK_KEY) : null;
  // First run: start from a recent window (the treasury sent its first tx only on
  // 2026-07-16, so nothing older can be a buyback). Later runs resume from cursor.
  let cursor = saved ? BigInt(saved) + ONE : latest > WINDOW ? latest - WINDOW : ZERO;
  if (cursor > latest) return;

  const startedAt = Date.now();
  let chunks = 0;
  while (cursor <= latest && chunks < MAX_CHUNKS_PER_RUN && Date.now() - startedAt < RUN_BUDGET_MS) {
    const end = cursor + CHUNK - ONE < latest ? cursor + CHUNK - ONE : latest;
    let hashes: Set<string>;
    try {
      // Funding legs land VIRTUAL in the treasury; buyback legs land MONVERA.
      const [virtLogs, monLogs] = await Promise.all([
        logsClient.getLogs({ address: VIRTUAL.address, event: TRANSFER, args: { to: TREASURY }, fromBlock: cursor, toBlock: end }),
        logsClient.getLogs({ address: MONVERA.address, event: TRANSFER, args: { to: TREASURY }, fromBlock: cursor, toBlock: end }),
      ]);
      hashes = new Set([...virtLogs, ...monLogs].map((l) => l.transactionHash as string));
    } catch (err) {
      console.error("[buyback] getLogs failed", { fromBlock: String(cursor), toBlock: String(end), err });
      return; // progress up to the previous chunk is already saved
    }

    // One unclassifiable tx must never wedge the cursor: a permanently failing
    // receipt would otherwise re-run and re-fail on every request forever.
    for (const h of hashes) {
      try {
        await classifyTx(h as `0x${string}`);
      } catch (err) {
        console.error("[buyback] classifyTx failed", { tx: h, err });
      }
    }

    cursor = end + ONE;
    chunks++;
    // Persist after EVERY chunk. Saving only after the whole loop meant a
    // Worker killed mid-catch-up discarded all progress and restarted from the
    // same block on every run — the cursor sat at 10.7M while indexed rows
    // existed at 11.2M, and four buybacks never got recorded.
    if (store) await store.put(LAST_BLOCK_KEY, (cursor - ONE).toString());
  }
}

/** Record new treasury funding and buyback legs. Zerion first (decoded history,
 *  no block range to page over); the RPC log scanner is the fallback for when
 *  Zerion is unset, erroring, or lagging. Both write the same rows and are
 *  idempotent, so falling back mid-catch-up is safe. */
export async function indexBuybacks(): Promise<void> {
  if (ZERION_KEY) {
    try {
      await indexViaZerion();
      return;
    } catch (err) {
      console.error("[buyback] zerion index failed, falling back to RPC", err);
    }
  }
  await indexViaRpc();
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
