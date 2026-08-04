import "server-only";

// The auto-manage driver: the six-hour pass that turns signed consent into
// actual rebalances. Safety gates run first, in order — the KV kill switch
// (rebalance:kill, FAIL CLOSED: an unreadable switch halts the run like a set
// one), an advisory run lock, the manager gas floor, then receipt repair for
// any prior window's unconfirmed send. The only session gate is per-symbol
// feed FRESHNESS (tokenized markets trade 24/7; the contract hard-reverts
// stale oracle rounds, which in practice throttles weekend windows and
// nothing else). Then, for every launched grove it
//
//   1. finds who ever opted in (AutoEnabled events, Blockscout v2) and keeps
//      only those still enabled, off cooldown, and with budget left,
//   2. reads their position + live prices and asks the pure planner
//      (rebalancePlan.ts) whether the basket has genuinely drifted,
//   3. asks Vera whether NOW is the window (rebalanceJudgment.ts) — ONE
//      verdict per grove per pass, so every depositor moves together; the
//      model can only veto plans the math justified, and every failure defers,
//   4. quotes the legs on Kyber exactly like a grove buy (the CONTRACT is
//      sender and recipient — it executes and measures every leg itself),
//   5. SIMULATES managedRebalance as the manager — one call proves the oracle
//      bands, the caps, the cooldown, and the allowances all hold — and only
//      then sends it, signed by the manager hot key; executions (never reads)
//      are capped per run, worst drift first (R10),
//   6. notifies the user — their own numbers first, then Vera's market read;
//      the Rebalances panel picks the event up on its own.
//
// Every (user, grove) the pass touches gets its true name in the D1 ledger
// (rebalanceStore, migration 0012): a pricing outage is never "no drift", a
// missing receipt is never "failed" — fail closed, record truthfully. The
// contract is the enforcement layer (per-token fraction, oracle-valued
// turnover, lifetime budget — AutoConfig); everything here is merely polite:
// it plans small, checks first, and logs loud. Nothing in this file is
// trusted by the chain.
import { createPublicClient, createWalletClient, encodeEventTopics, encodeFunctionData, erc20Abi, http, keccak256, parseAbi, parseAbiItem, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { chain, EXPLORER_URL } from "@/lib/chain";
import { GROVES, type GroveDef } from "@/lib/groves";
import { ALL_ASSETS, assetBySymbol, USDG, MULTICALL3, type Asset } from "@/lib/tokens";
import type { AssetPrice } from "@/lib/prices";
import { SERVER_RPC_URL } from "./rpc";
import { priceAllWithFallback } from "./pricing";
import { kyberQuote } from "./kyber";
import { GROVE_MANAGER, GROVE_LEG_SLIPPAGE_BPS } from "./groveQuote";
import { computeRebalancePlan, type PlanHolding, type PlanTarget } from "./rebalancePlan";
import { judgeRebalance, displayReason, type JudgmentRow, type RebalanceVerdict } from "./rebalanceJudgment";
import { veraTilt, TILT_TRIGGER_BPS, type TiltResult, type TiltRow } from "./veraTilt";
import { universeStatsRows } from "./quant";
import { getDaySummary } from "./marketData";
import { recentHeadlines } from "./newsFeed";
import { addNotification } from "./notifyStore";
import { listRecentUsers } from "./userDirectory";
import {
  runIdForWindow,
  recordRunStart,
  recordRunFinish,
  upsertOutcome,
  markNotified,
  listUnconfirmed,
  listUnnotified,
  resolveUnconfirmed,
  markBudgetNoticeSent,
  wasBudgetNoticeRecent,
  latestRuns,
  pruneLedger,
  turnoverSince,
  type RunGate,
  type RebalanceOutcome,
  type RebalanceLeg,
  type BudgetNoticeKind,
} from "./rebalanceStore";

const ABI = parseAbi([
  "struct SwapLeg { address tokenIn; address tokenOut; uint256 amountIn; uint256 minOut; address callTarget; address approvalTarget; bytes data; }",
  "function managedRebalance(address user, uint256 groveId, SwapLeg[] legs, uint256 deadline)",
  "function autoConfigs(address user, uint256 groveId) view returns (bool enabled, uint256 maxPerBuyUsdg, uint256 maxTotalUsdg, uint256 managerMovedUsdg, uint256 minSecondsBetween, uint256 lastManagerAction, uint16 maxRebalanceFractionBps)",
  "function positionOf(address user, uint256 groveId) view returns (uint256 costBasisUsdg, address[] tokens, uint256[] amounts)",
  "function paused() view returns (bool)",
]);

const AUTO_ENABLED = parseAbiItem(
  "event AutoEnabled(address indexed user, uint256 indexed groveId, uint256 maxPerBuyUsdg, uint256 maxTotalUsdg, uint256 minSecondsBetween, uint16 maxRebalanceFractionBps)",
);

const HEADERS = { "user-agent": "monvera/1.0 (+https://monvera.best)", accept: "application/json" } as const;

/** Act only past this weight deviation. Mirrors the product copy: "only when
 *  it has genuinely drifted". */
const DRIFT_TRIGGER_BPS = 500;
/** Oracle-vs-our-prices headroom: plan slightly under the user's cap so the
 *  contract's own (Chainlink-priced) turnover check cannot trip on a few bps
 *  of valuation difference. */
const CAP_HAIRCUT = 0.98;
/** R10: caps EXECUTIONS only — planning is cheap reads and everyone eligible
 *  gets planned. Worst drift first decides who sends when the cap bites, so
 *  anyone trimmed is front of the line next window by construction. */
const MAX_USERS_PER_RUN = 20;
const DEADLINE_SECONDS = 600;
/** Executions halt (and the owner is paged) below this manager balance — a
 *  flat trip-wire, not budgeting: at ~$0.0001 per tx, 0.001 ETH is months of
 *  ceiling-throughput spend. */
const GAS_FLOOR_WEI = BigInt(10) ** BigInt(15); // 0.001 ETH
/** R7, feed half: mirrors the contracts' measured FEED_HEARTBEAT (86400s —
 *  4663 equity feeds gap up to ~19h intra-week). At or past this age the
 *  contract hard-reverts StaleFeedForManaged, so quoting or judging a plan
 *  that touches an older round buys a guaranteed revert. */
const FEED_MAX_AGE_S = 86_400;
/** Incident brake: `wrangler kv key put rebalance:kill 1` stops the next pass
 *  in seconds, no deploy. FAIL CLOSED — KV unreachable halts too. */
const KILL_KEY = "rebalance:kill";
/** Advisory only, renewed after every executed user so it cannot lapse
 *  mid-run. Real idempotency is the D1 upsert key plus the contract cooldown;
 *  notification dedup keys off the ledger, never this lock. */
const LOCK_TTL_S = 600;
/** Active management may turn a holder's basket over this much per rolling 30
 *  days before it reverts to passive drift maintenance for them. 25% is about
 *  eight full tilt-sized rebalances a month; past that the spread starts to
 *  outweigh what the adjustments are worth. */
const TURNOVER_BUDGET_FRACTION = 0.25;
const SIM_REFUSED = "simulation refused";

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** Raw KV, kvCache's pattern. Null outside a CF context — which the kill
 *  switch treats as "unreadable", halting the run. */
function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null;
  }
}

const client = createPublicClient({
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

interface Outcome {
  grove: string;
  user: Address;
  outcome: RebalanceOutcome;
  reason: string;
  txHash?: `0x${string}`;
  turnoverUsd?: number;
  /** Vera's one-sentence timing rationale, VERBATIM — user surfaces must
   *  render it through displayReason(), never directly. */
  veraReason?: string;
  lintOk?: boolean;
  /** Per-leg instrumentation, amounts as decimal strings (JSON-safe: the
   *  cron route serializes this whole report). */
  legs?: RebalanceLeg[];
}

/** A prior window's unconfirmed send, re-checked this pass. */
export interface RepairResult {
  runId: string;
  grove: string;
  user: string;
  resolved: "rebalanced" | "failed" | "pending";
  txHash?: string;
}

export interface AutoRebalanceReport {
  ran: boolean;
  runId: string;
  /** Absent when a config guard (manager address/key, paused) stopped the run
   *  before the window gates applied. */
  gate?: RunGate;
  reason?: string;
  outcomes: Outcome[];
  repairs: RepairResult[];
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}

/** Fresh means a Chainlink round younger than the feed heartbeat — and this
 *  is the ONLY session gate. Tokenized markets trade around the clock, so the
 *  driver acts in every 6h window where the touched feeds are fresh; a
 *  wall-clock "market hours" gate was tried and dropped as TradFi cosplay
 *  (user buys settle fine at 1am through the same pools and bands).
 *  Weeknights the rounds stay inside the 24h heartbeat; weekends they gap
 *  52h+, so Saturday-evening-to-Monday windows throttle themselves per
 *  symbol, by the oracle's actual state instead of a clock's guess at it.
 *  Fallback-priced symbols (arcus/market/none) count stale: the CONTRACT
 *  prices every leg from its feed, whatever our sweep fell back to. */
function feedFresh(p: AssetPrice | undefined, nowSeconds: number): boolean {
  return p?.source === "chainlink" && p.updatedAt !== undefined && nowSeconds - p.updatedAt < FEED_MAX_AGE_S;
}

/** RED events page the owner through the ordinary notification inbox.
 *  OWNER_USER_ID is the owner's user-directory id (wrangler.jsonc vars);
 *  unset means alerting is off — deliberately, so a fork or preview without
 *  the var never pages anyone. */
async function alertOwner(title: string, body: string): Promise<void> {
  const owner = process.env.OWNER_USER_ID;
  if (!owner) return;
  await addNotification(owner, { kind: "system", title: `Auto-manage: ${title}`, body, at: Date.now() });
}

/** R8 consent-meter notices, at-most-once per budget epoch: the ledger claim
 *  (markBudgetNoticeSent, keyed on the on-chain moved value) decides, and the
 *  send happens only when THIS call claimed the key. No directory entry means
 *  no claim — the notice waits until the user is reachable rather than
 *  burning its one shot on nobody. */
async function sendBudgetNotice(
  def: GroveDef,
  user: Address,
  bySmart: Map<string, string>,
  kind: BudgetNoticeKind,
  moved: bigint,
  maxTotal: bigint,
): Promise<void> {
  const userId = bySmart.get(user.toLowerCase());
  if (!userId) return;
  // Low-water re-arms on every budget-consuming action (the moved value in
  // the claim key changes) — a 30-day suppression keeps it to one honest note
  // per epoch instead of one per action in the 75-100% tail. Exhaustion needs
  // no window: moved freezes, so its key is naturally once.
  if (kind === "low-water" && (await wasBudgetNoticeRecent(user, def.id, kind))) return;
  if (!(await markBudgetNoticeSent(user, def.id, moved, kind))) return;
  const remaining = Math.max(0, Number(maxTotal - moved) / 1e6);
  const total = Number(maxTotal) / 1e6;
  if (kind === "low-water") {
    await addNotification(userId, {
      kind: "system",
      title: `${def.name} auto-manage budget running low`,
      body:
        `About $${remaining.toFixed(2)} of the $${total.toFixed(2)} lifetime budget you approved for ${def.name} remains — under 25%. ` +
        "This is an early, limited setting. One signature in the grove's Managed card upgrades it to full management; nothing changes on its own.",
      at: Date.now(),
    });
  } else {
    await addNotification(userId, {
      kind: "system",
      title: `${def.name} auto-manage budget spent`,
      body:
        `Auto-manage has stopped for your ${def.name} basket: too little of the $${total.toFixed(2)} lifetime budget you approved remains to cover another move. ` +
        "This is an early, limited setting. One signature in the grove's Managed card upgrades it to full management; nothing changes on its own.",
      at: Date.now(),
    });
  }
}

/** Every address that ever emitted AutoEnabled for this grove (v2, one page
 *  loop). Revokes and cap edits are re-checked on-chain afterwards, so stale
 *  entries here cost one autoConfigs read, never a wrong action. */
async function optedInCandidates(onChainId: number): Promise<Address[]> {
  const topic0 = encodeEventTopics({ abi: [AUTO_ENABLED] })[0];
  const groveTopic = toHex(BigInt(onChainId), { size: 32 }).toLowerCase();
  const users = new Set<Address>();
  let params = "";
  for (let page = 0; page < 6; page++) {
    const res = await fetch(`${EXPLORER_URL}/api/v2/addresses/${GROVE_MANAGER}/logs${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`blockscout v2 logs ${res.status}`);
    const json = (await res.json()) as {
      items?: { topics: (string | null)[] }[];
      next_page_params?: Record<string, string | number> | null;
    };
    for (const it of json.items ?? []) {
      const t = it.topics ?? [];
      if (t[0] === topic0 && t[2]?.toLowerCase() === groveTopic && t[1]) {
        users.add((`0x${t[1].slice(-40)}`) as Address);
      }
    }
    const next = json.next_page_params;
    if (!next || Object.keys(next).length === 0) break;
    params = "?" + new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)])).toString();
  }
  return [...users];
}

const byAddress = new Map<string, Asset>(ALL_ASSETS.map((a) => [a.address.toLowerCase(), a]));

/** A user whose basket has genuinely drifted, plan ready — awaiting the
 *  grove-wide verdict before anything is quoted or sent. */
interface PlannedUser {
  user: Address;
  plan: NonNullable<ReturnType<typeof computeRebalancePlan>>;
  rows: JudgmentRow[];
}

/** Read-only state one window shares across planOne calls. */
interface RunCtx {
  prices: Record<string, AssetPrice>;
  nowSeconds: number;
  /** smart account (lowercase) → directory userId, resolved once per run. */
  bySmart: Map<string, string>;
  /** Users whose plan touched a stale feed this window (gate accounting). */
  staleBlocked: number;
  /** This window's ACTIVE target weights per grove id: symbol → bps, always
   *  summing to 10000 and always inside the published band (clampWeights).
   *  Absent, or source "base", means the published weights — which is exactly
   *  the drift-only behaviour the vault had before active management. */
  tilt: Map<string, TiltResult>;
}

/** KV brake for active management alone: `wrangler kv key put tilt:off 1`
 *  reverts every grove to published weights within a window, without touching
 *  the rebalancer itself and without a deploy. Unreadable KV means OFF here
 *  (unlike the kill switch, which fails closed) — the safe state for active
 *  management is the passive behaviour that ran before it. */
async function tiltEnabled(): Promise<boolean> {
  if ((process.env.VERA_TILT ?? "on") === "off") return false;
  try {
    return !(await kv()?.get("tilt:off"));
  } catch {
    return false;
  }
}

/** This window's active weights for one grove. Never throws: any failure is
 *  the published weights, which is the drift-only vault. */
async function tiltFor(def: GroveDef): Promise<TiltResult> {
  const base: Record<string, number> = {};
  for (const c of def.components) base[c.symbol] = c.weightBps;
  const passive: TiltResult = { weights: base, reason: "Published weights kept for this window.", source: "base", lintOk: true };
  try {
    if (!(await tiltEnabled())) return passive;
    const symbols = def.components.map((c) => c.symbol);
    const [stats, day, news] = await Promise.all([
      universeStatsRows(symbols).catch(() => []),
      getDaySummary().catch(() => ({}) as Awaited<ReturnType<typeof getDaySummary>>),
      recentHeadlines(symbols).catch(() => new Map<string, { title: string; ageH: number }>()),
    ]);
    const statBy = new Map(stats.map((s) => [s.symbol, s]));
    const rows: TiltRow[] = def.components.map((c) => ({
      symbol: c.symbol,
      baseWeightBps: c.weightBps,
      dayChangePct: (day as Record<string, { dayChangePct?: number }>)[c.symbol]?.dayChangePct,
      ret3mPct: statBy.get(c.symbol)?.ret3mPct,
      volPct: statBy.get(c.symbol)?.volPct,
      headline: news.get(c.symbol),
    }));
    return await veraTilt(def.name, rows);
  } catch (err) {
    console.error("[auto-rebalance] tilt failed, using published weights", msg(err));
    return passive;
  }
}

/** This window's target weight for one symbol: Vera's active weight when she
 *  set one, the published weight otherwise. Never reads the model's raw
 *  numbers — ctx.tilt only ever holds clamped, summed-to-10000 weights. */
function baseWeight(def: GroveDef, symbol: string): number {
  return def.components.find((c) => c.symbol === symbol)?.weightBps ?? 0;
}

function targetOf(def: GroveDef, ctx: RunCtx, symbol: string): number {
  return ctx.tilt.get(def.id)?.weights[symbol] ?? baseWeight(def, symbol);
}

/** Everything up to (and including) the pure plan. No venue, no sends — the
 *  only write is a possible consent-meter notice. */
async function planOne(def: GroveDef, user: Address, ctx: RunCtx): Promise<Outcome | PlannedUser> {
  const groveId = BigInt(def.onChainId!);
  const managerAddr = GROVE_MANAGER as Address;
  const out = (outcome: RebalanceOutcome, reason: string): Outcome => ({ grove: def.id, user, outcome, reason });

  const [enabled, maxPerBuy, maxTotal, moved, cooldown, lastAction, fractionBps] = await client.readContract({
    address: managerAddr,
    abi: ABI,
    functionName: "autoConfigs",
    args: [user, groveId],
  });
  if (!enabled) return out("skipped", "consent revoked");
  const now = Math.floor(Date.now() / 1000);
  if (lastAction !== BigInt(0) && now < Number(lastAction) + Number(cooldown)) return out("skipped", "cooldown");
  const remainingUsd = Number(maxTotal - moved) / 1e6;
  const perActionUsd = Number(maxPerBuy) / 1e6;
  const maxTurnoverUsd = Math.min(perActionUsd, remainingUsd) * CAP_HAIRCUT;
  // R8 exhaustion — this exact condition is the one the panel and the
  // exhaustion notice must agree with; never restate it differently.
  if (maxTurnoverUsd < 15) {
    await sendBudgetNotice(def, user, ctx.bySmart, "exhausted", moved, maxTotal);
    return out("skipped", "budget-exhausted");
  }
  // R8 low-water: under 25% lifetime headroom the user hears it once per
  // budget epoch (the epoch key is the on-chain moved value — re-signing
  // enableAuto resets it, opening a fresh epoch).
  if (maxTotal > BigInt(0) && Number(moved) / Number(maxTotal) >= 0.75) {
    await sendBudgetNotice(def, user, ctx.bySmart, "low-water", moved, maxTotal);
  }

  const [costBasis, tokens, amounts] = await client.readContract({
    address: managerAddr,
    abi: ABI,
    functionName: "positionOf",
    args: [user, groveId],
  });
  if (costBasis === BigInt(0)) return out("skipped", "no position");

  // Standing allowances bound what a sell leg may pull — read them up front so
  // the planner never plans a pull the transferFrom would revert.
  const held = tokens.map((t, i) => ({ token: t, amountRaw: amounts[i] })).filter((x) => x.amountRaw > BigInt(0));
  if (!held.length) return out("skipped", "empty position");
  // Sells are bounded by what the wallet can actually deliver: the standing
  // allowance AND the live balance. The contract's position ledger can exceed
  // the wallet (the user may have sold a name through the ordinary flows), and
  // a plan that ignores that quotes doomed legs — every one a simulation
  // refusal that pages the owner for nothing.
  const [allowances, balances] = await Promise.all([
    Promise.all(
      held.map((x) =>
        client.readContract({ address: x.token, abi: erc20Abi, functionName: "allowance", args: [user, managerAddr] }),
      ),
    ),
    Promise.all(
      held.map((x) =>
        client.readContract({ address: x.token, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
      ),
    ),
  ]);

  // Turnover budget, per holder per rolling 30 days. Spent budget does NOT
  // stop the basket being managed — it drops this user back to passive drift
  // maintenance (published weights, 500 bps trigger), which is the behaviour
  // that needs no budget because the market, not Vera, decides when it fires.
  const spentUsd = await turnoverSince(user, def.id, Date.now() - 30 * 86_400_000);
  const positionUsd = held.reduce(
    (s, h) => s + (Number(h.amountRaw) / 1e18) * (ctx.prices[byAddress.get(h.token.toLowerCase())?.symbol ?? ""]?.priceUsd ?? 0),
    0,
  );
  const overBudget = positionUsd > 0 && spentUsd > positionUsd * TURNOVER_BUDGET_FRACTION;

  const holdings: PlanHolding[] = [];
  for (let i = 0; i < held.length; i++) {
    const asset = byAddress.get(held[i].token.toLowerCase());
    if (!asset) return out("skipped", `unknown token ${held[i].token} in position`);
    const deliverable = [held[i].amountRaw, allowances[i], balances[i]].reduce((a, b) => (a < b ? a : b));
    holdings.push({
      token: held[i].token,
      symbol: asset.symbol,
      amountRaw: held[i].amountRaw,
      sellableRaw: deliverable,
      priceUsd: ctx.prices[asset.symbol]?.priceUsd ?? 0,
      targetWeightBps: overBudget ? baseWeight(def, asset.symbol) : targetOf(def, ctx, asset.symbol),
    });
  }
  // Record truthfully: a holding the sweep could not price is an OUTAGE, and
  // planning around it would misread drift — never "no drift".
  const unpriced = holdings.filter((h) => !(h.priceUsd > 0)).map((h) => h.symbol);
  if (unpriced.length) return out("pricing-unavailable", `no price for ${unpriced.join(", ")}`);

  const missing: PlanTarget[] = def.components
    .filter((c) => !holdings.some((hh) => hh.symbol === c.symbol))
    .map((c) => ({ token: assetBySymbol(c.symbol)!.address as Address, symbol: c.symbol, targetWeightBps: overBudget ? baseWeight(def, c.symbol) : targetOf(def, ctx, c.symbol) }));

  // A tilt is a deliberate decision, so it is acted on at a lower bar than
  // passive drift: Vera moved the target meaning it to happen THIS window.
  const tilted = !overBudget && ctx.tilt.get(def.id)?.source === "model";
  const triggerBps = tilted ? TILT_TRIGGER_BPS : DRIFT_TRIGGER_BPS;
  const plan = computeRebalancePlan(holdings, missing, { maxTurnoverUsd, maxFractionBps: Number(fractionBps) }, { driftTriggerBps: triggerBps });
  if (!plan) {
    // No hard-coded dollar floor here: it scales with the position now
    // (rebalancePlan), so naming one number would be wrong for most baskets.
    return out("no-drift", `no actionable plan (drift under ${triggerBps} bps, too small a move to be worth its costs, or nothing sellable within caps)`);
  }

  // R7, feed half, per touched symbol: a plan touching a stale round cannot
  // execute, so it is neither quoted nor judged.
  const touched = new Set([...plan.sells.map((s) => s.symbol), ...plan.buys.map((b) => b.symbol)]);
  const stale = [...touched].filter((sym) => !feedFresh(ctx.prices[sym], ctx.nowSeconds));
  if (stale.length) {
    ctx.staleBlocked += 1;
    return out("skipped", `stale oracle feed: ${stale.join(", ")}`);
  }

  const totalUsd = holdings.reduce((s, x) => s + (Number(x.amountRaw) / 1e18) * x.priceUsd, 0);
  const rows: JudgmentRow[] = [...touched].map((symbol) => {
    const hh = holdings.find((x) => x.symbol === symbol);
    const currentPct = hh ? (((Number(hh.amountRaw) / 1e18) * hh.priceUsd) / totalUsd) * 100 : 0;
    const targetPct = (def.components.find((c) => c.symbol === symbol)?.weightBps ?? 0) / 100;
    return { symbol, currentWeightPct: currentPct, targetWeightPct: targetPct, deviationPct: currentPct - targetPct };
  });
  return { user, plan, rows };
}

/** Quote, prove, send — runs only after the grove-wide verdict said "now".
 *  `writeAhead` persists an "unconfirmed" row with the tx hash BEFORE the
 *  broadcast (the hash is known from the signed envelope): an invocation
 *  death between broadcast and bookkeeping would otherwise move money with
 *  no trace for repair to find. When the write-ahead cannot land, nothing is
 *  sent — money never moves unrecorded. */
async function executeOne(
  def: GroveDef,
  user: Address,
  manager: ReturnType<typeof privateKeyToAccount>,
  plan: PlannedUser["plan"],
  verdict: RebalanceVerdict,
  prices: Record<string, AssetPrice>,
  writeAhead: (o: Outcome) => Promise<number | null>,
): Promise<Outcome> {
  const groveId = BigInt(def.onChainId!);
  const managerAddr = GROVE_MANAGER as Address;
  const base = { grove: def.id, user, veraReason: verdict.reason, lintOk: verdict.lintOk };
  const skip = (reason: string): Outcome => ({ ...base, outcome: "skipped", reason });

  // §6 metric 5: the sweep's 8dp Chainlink answer, reconstructed exactly.
  // Stale or fallback-priced symbols never reach execution, so a zero here
  // means a bug upstream, not a data gap.
  const oracleAnswer = (symbol: string): string => {
    const p = prices[symbol];
    return p?.source === "chainlink" && p.priceUsd ? BigInt(Math.round(p.priceUsd * 1e8)).toString() : "0";
  };

  // ── quote the legs, sells first (they fund the pool the buys spend) ──
  type Leg = { tokenIn: Address; tokenOut: Address; amountIn: bigint; minOut: bigint; callTarget: Address; approvalTarget: Address; data: `0x${string}` };
  const legs: Leg[] = [];
  const ledgerLegs: RebalanceLeg[] = [];
  let pool = BigInt(0);
  for (const s of plan.sells) {
    const q = await kyberQuote(s.token, USDG.address as Address, s.amountRaw, managerAddr, managerAddr, "none", GROVE_LEG_SLIPPAGE_BPS);
    if (!q || q.minBuyAmount <= BigInt(0)) return skip(`no sell route for ${s.symbol}`);
    const router = q.steps[1].to;
    legs.push({ tokenIn: s.token, tokenOut: USDG.address as Address, amountIn: s.amountRaw, minOut: q.minBuyAmount, callTarget: router, approvalTarget: router, data: q.steps[1].data });
    // expected = the quote's net output; realized stays null until receipt
    // decoding lands (the ledger column waits for it).
    ledgerLegs.push({ symbol: s.symbol, side: "sell", amountIn: s.amountRaw.toString(), expected: q.buyAmount.toString(), minOut: q.minBuyAmount.toString(), oracleAnswer: oracleAnswer(s.symbol), realized: null });
    pool += q.minBuyAmount;
  }
  // Spend only what the sells are GUARANTEED to realize (the sum of their
  // minOuts): actual proceeds land at or above it, and the surplus rides home
  // as the contract's capped residue refund.
  let spent = BigInt(0);
  for (let i = 0; i < plan.buys.length; i++) {
    const b = plan.buys[i];
    const amountIn = i === plan.buys.length - 1 ? pool - spent : (pool * BigInt(Math.round(b.share * 1e6))) / BigInt(1e6);
    if (amountIn <= BigInt(0)) continue;
    const q = await kyberQuote(USDG.address as Address, b.token, amountIn, managerAddr, managerAddr, "none", GROVE_LEG_SLIPPAGE_BPS);
    if (!q || q.minBuyAmount <= BigInt(0)) return skip(`no buy route for ${b.symbol}`);
    const router = q.steps[1].to;
    legs.push({ tokenIn: USDG.address as Address, tokenOut: b.token, amountIn, minOut: q.minBuyAmount, callTarget: router, approvalTarget: router, data: q.steps[1].data });
    ledgerLegs.push({ symbol: b.symbol, side: "buy", amountIn: amountIn.toString(), expected: q.buyAmount.toString(), minOut: q.minBuyAmount.toString(), oracleAnswer: oracleAnswer(b.symbol), realized: null });
    spent += amountIn;
  }
  if (legs.length === plan.sells.length) return skip("no buy leg could be built");

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  // One simulation proves everything the contract will check — bands, caps,
  // cooldown, allowances, composition membership — before any gas is spent.
  try {
    await client.simulateContract({
      account: manager,
      address: managerAddr,
      abi: ABI,
      functionName: "managedRebalance",
      args: [user, groveId, legs, deadline],
    });
  } catch (err) {
    console.error(`[auto-rebalance] simulation refused ${def.id}/${user}`, err);
    return { ...skip(`${SIM_REFUSED}: ${msg(err)}`), legs: ledgerLegs };
  }

  // Sign first: the hash is the keccak of the signed envelope, so it is known
  // before the chain is. A broadcast error can land AFTER the node accepted
  // the raw tx (HTTP timeout), so from here on the only honest failure states
  // are "signing failed" (nothing exists) and "unconfirmed" (the chain may
  // know it) — never a bare "failed" that a mined tx could contradict.
  const wallet = createWalletClient({ account: manager, chain, transport: http(SERVER_RPC_URL) });
  let serialized: `0x${string}`;
  let hash: `0x${string}`;
  try {
    const request = await wallet.prepareTransactionRequest({
      to: managerAddr,
      data: encodeFunctionData({ abi: ABI, functionName: "managedRebalance", args: [user, groveId, legs, deadline] }),
    });
    serialized = await wallet.signTransaction(request);
    hash = keccak256(serialized);
  } catch (err) {
    console.error(`[auto-rebalance] signing failed ${def.id}/${user}`, err);
    return { ...base, outcome: "failed", reason: `signing failed (nothing sent): ${msg(err)}`, turnoverUsd: plan.turnoverUsd, legs: ledgerLegs };
  }

  const ahead = await writeAhead({ ...base, outcome: "unconfirmed", reason: "signed — broadcasting", txHash: hash, turnoverUsd: plan.turnoverUsd, legs: ledgerLegs });
  if (ahead === null) return skip("ledger write-ahead failed — not sent (fail closed)");

  try {
    await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (err) {
    // The node may have accepted it despite the error. The write-ahead row
    // already carries the right hash, so repair resolves it either way.
    console.error(`[auto-rebalance] broadcast unclear ${def.id}/${user}`, err);
    return { ...base, outcome: "unconfirmed", reason: `broadcast unclear: ${msg(err)}`, txHash: hash, turnoverUsd: plan.turnoverUsd, legs: ledgerLegs };
  }
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") {
      console.error(`[auto-rebalance] reverted on-chain ${def.id}/${user}`, hash);
      return { ...base, outcome: "failed", reason: "reverted on-chain", txHash: hash, turnoverUsd: plan.turnoverUsd, legs: ledgerLegs };
    }
  } catch {
    // Mined status UNKNOWN — never "failed". The row stays "unconfirmed"
    // until the next window's repair pass reads the real receipt; the caller
    // halts further sends (a stuck tx queues every later manager nonce).
    return { ...base, outcome: "unconfirmed", reason: "no receipt within 120s — status unknown", txHash: hash, turnoverUsd: plan.turnoverUsd, legs: ledgerLegs };
  }
  return { ...base, outcome: "rebalanced", reason: `drift ${plan.maxDeviationBps}bps`, txHash: hash, turnoverUsd: plan.turnoverUsd, legs: ledgerLegs };
}

/** Re-check every stored unconfirmed tx hash against the chain. Mined-success
 *  upgrades the row to "rebalanced" (late user notification, honest about the
 *  delay); mined-revert becomes "failed" (owner alert + user notification).
 *  Still-pending rows stay, page the owner, and block new sends for that
 *  (user, grove) this pass. THROWS when the ledger is unreadable — the caller
 *  halts the window, fail closed. */
async function repairUnconfirmed(bySmart: Map<string, string>): Promise<{ repairs: RepairResult[]; blocked: Set<string> }> {
  const rows = await listUnconfirmed();
  const repairs: RepairResult[] = [];
  const blocked = new Set<string>();
  let stillPending = 0;
  for (const row of rows) {
    const result: RepairResult = { runId: row.runId, grove: row.groveId, user: row.user, resolved: "pending", txHash: row.txHash };
    let receipt: { status: string } | null = null;
    if (row.txHash) {
      try {
        receipt = await client.getTransactionReceipt({ hash: row.txHash as `0x${string}` });
      } catch {
        /* not found yet, or an RPC blip — either way the status stays unknown */
      }
    }
    if (!receipt) {
      // Terminal-drop rule: every tx carries a 600s deadline, so past an hour
      // an unmined one can only ever mine as a revert — and one the node no
      // longer even knows is gone. Marking it failed is safe: the contract
      // state is untouched (the cooldown was never consumed), so the next
      // window simply retries.
      let known = false;
      if (row.txHash) {
        try {
          known = (await client.getTransaction({ hash: row.txHash as `0x${string}` })) !== null;
        } catch {
          known = false; // TransactionNotFound — the pool has no trace of it
        }
      }
      if (!known && Date.now() - row.createdAt > 3_600_000) {
        result.resolved = "failed";
        if (await resolveUnconfirmed(row.id, "failed", "expired unmined — no receipt and no mempool trace after 1h")) {
          await alertOwner(
            "unconfirmed send expired unmined",
            `${row.groveId}/${row.user} tx ${row.txHash} never mined and its deadline is long past. Marked failed; the next window retries.`,
          );
          const droppedUserId = bySmart.get(row.user.toLowerCase());
          if (droppedUserId) {
            const droppedName = GROVES.find((g) => g.id === row.groveId)?.name ?? row.groveId;
            await addNotification(droppedUserId, {
              kind: "system",
              title: `${droppedName} rebalance did not complete`,
              body: "The rebalance we told you was pending never made it on-chain — nothing moved. The next pass will look again.",
              txHash: row.txHash,
              at: Date.now(),
            });
          }
        }
        repairs.push(result);
        continue;
      }
      blocked.add(`${row.groveId}:${row.user.toLowerCase()}`);
      stillPending += 1;
      repairs.push(result);
      continue;
    }
    const name = GROVES.find((g) => g.id === row.groveId)?.name ?? row.groveId;
    const userId = bySmart.get(row.user.toLowerCase());
    if (receipt.status === "success") {
      result.resolved = "rebalanced";
      // resolveUnconfirmed only flips a still-unconfirmed row, so the late
      // notification sends exactly once even across concurrent passes.
      if (await resolveUnconfirmed(row.id, "rebalanced", "confirmed on repair (late receipt)")) {
        if (userId) {
          const read = row.veraReason !== undefined
            ? ` Vera's market read: ${displayReason({ action: "proceed", reason: row.veraReason, source: "model", lintOk: row.lintOk ?? false })}`
            : "";
          // notified only records DELIVERY — a failed insert leaves the row
          // for listUnnotified's repair sweep, never a phantom "reached".
          const delivered = await addNotification(userId, {
            kind: "system",
            title: `${name} rebalanced (confirmed late)`,
            body: `Your ${name} rebalance took longer than usual to confirm — it has now landed. About $${(row.turnoverUsd ?? 0).toFixed(2)} realigned toward its published weights. Price-checked on-chain, as always.${read} The transaction is in the grove's Rebalances list.`,
            txHash: row.txHash,
            at: Date.now(),
          });
          if (delivered) await markNotified(row.id);
        }
      }
    } else {
      result.resolved = "failed";
      if (await resolveUnconfirmed(row.id, "failed", "reverted on-chain (receipt found on repair)")) {
        await alertOwner("unconfirmed send resolved to reverted", `${row.groveId}/${row.user} tx ${row.txHash} reverted on-chain.`);
        if (userId) {
          await addNotification(userId, {
            kind: "system",
            title: `${name} rebalance did not complete`,
            body: "The rebalance we told you was pending reverted on-chain — nothing moved. The next pass will look again.",
            txHash: row.txHash,
            at: Date.now(),
          });
        }
      }
    }
    repairs.push(result);
  }
  if (stillPending > 0) {
    await alertOwner(
      "unconfirmed sends still unresolved after repair",
      `${stillPending} rebalance transaction(s) still have no receipt; new sends for those (user, grove) pairs are blocked this window.`,
    );
  }
  return { repairs, blocked };
}

function countBy(outcomes: Outcome[]): Partial<Record<RebalanceOutcome, number>> {
  const counts: Partial<Record<RebalanceOutcome, number>> = {};
  for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
  return counts;
}

export async function runAutoRebalance(): Promise<AutoRebalanceReport> {
  const runId = runIdForWindow();
  const startedAt = Date.now();
  const bail = (reason: string, gate?: RunGate): AutoRebalanceReport => ({ ran: false, runId, gate, reason, outcomes: [], repairs: [] });

  // ── kill switch, first and fail closed: unreadable = set ──
  const killedBail = async (why: string): Promise<AutoRebalanceReport> => {
    await recordRunStart(runId, startedAt);
    // Never clobber a real summary: a manual fire after this window already
    // finished must not rewrite its counts to zeros.
    const finished = await latestRuns(1).catch(() => null);
    if (!(finished?.[0]?.runId === runId && finished[0].finishedAt !== undefined)) {
      await recordRunFinish(runId, { startedAt, finishedAt: Date.now(), gate: "killed", counts: {}, error: why });
    }
    return bail(why, "killed");
  };
  const store = kv();
  if (!store) return killedBail("KV unreachable");
  let killReason: string | null = null;
  try {
    if ((await store.get(KILL_KEY)) !== null) killReason = `${KILL_KEY} is set`;
  } catch {
    killReason = "KV read failed";
  }
  if (killReason) return killedBail(killReason);

  // ── advisory run lock (guards concurrency, not idempotency) ──
  const lockKey = `rebalance:lock:${runId}`;
  try {
    if ((await store.get(lockKey)) !== null) {
      await recordRunStart(runId, startedAt);
      // No finish write: the window's ledger row belongs to the lock holder.
      return bail("another run holds this window's lock", "locked");
    }
  } catch {
    /* advisory: an unreadable lock never blocks — the kill switch above is the fail-closed gate */
  }
  const renewLock = async (): Promise<void> => {
    try {
      await store.put(lockKey, String(startedAt), { expirationTtl: LOCK_TTL_S });
    } catch (err) {
      console.warn("[auto-rebalance] lock write failed (continuing; upserts are idempotent)", msg(err));
    }
  };
  await renewLock();

  // A window that already ACTED never re-runs: re-planning after the lock
  // expired would overwrite rebalanced rows with "cooldown" skips, nulling
  // their tx hashes and legs. Other finished gates (off-session, gas-floor,
  // killed) may re-run — refiring after refuelling or clearing the kill is
  // legitimate, and the newer summary is the truer one.
  const prior = await latestRuns(1).catch(() => null);
  if (prior?.[0]?.runId === runId && prior[0].gate === "acted") {
    return bail("window already acted", "locked");
  }

  // ── config guards (unchanged; before any ledger row) ──
  if (!GROVE_MANAGER) return bail("GROVE_MANAGER unset");
  const key = process.env.GROVE_MANAGER_KEY;
  if (!key) return bail("GROVE_MANAGER_KEY unset");
  const manager = privateKeyToAccount(key as `0x${string}`);
  const paused = await client.readContract({ address: GROVE_MANAGER as Address, abi: ABI, functionName: "paused" }).catch(() => true);
  if (paused) return bail("contract paused");

  await recordRunStart(runId, startedAt);

  const outcomes: Outcome[] = [];
  const errors: string[] = [];
  const ledgerIds = new Map<Outcome, number>();
  const toInput = (o: Outcome) => ({
    runId,
    groveId: o.grove,
    user: o.user,
    outcome: o.outcome,
    reason: o.reason,
    txHash: o.txHash,
    turnoverUsd: o.turnoverUsd,
    veraReason: o.veraReason,
    lintOk: o.lintOk,
    legs: o.legs,
    at: Date.now(),
  });
  // "unconfirmed" rows are the ONLY pointer repair will ever have to a hash
  // whose fate is unknown — a lost write strands it forever. Retry, and when
  // the ledger truly won't take it, page the owner with the hash itself so a
  // human can record it.
  const upsertCritical = async (o: Outcome): Promise<number | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = await upsertOutcome(toInput(o));
      if (id !== null) return id;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
    await alertOwner(
      "ledger write lost for an in-flight transaction",
      `${o.grove}/${o.user} tx ${o.txHash ?? "(no hash)"} could not be written as ${o.outcome}. Repair cannot find it — record it manually.`,
    );
    return null;
  };
  const record = async (o: Outcome): Promise<void> => {
    outcomes.push(o);
    const id = o.outcome === "unconfirmed" ? await upsertCritical(o) : await upsertOutcome(toInput(o));
    if (id !== null) ledgerIds.set(o, id);
  };

  // One directory read serves repair notifications, consent-meter notices,
  // and the end-of-pass sends. The smart account is the position owner; the
  // directory maps it back to the person.
  const directory = await listRecentUsers(365, 2000).catch(() => []);
  const bySmart = new Map(directory.filter((d) => d.smartAddress).map((d) => [d.smartAddress!.toLowerCase(), d.userId]));

  // ── gas floor: planning and ledger rows continue, sends do not ──
  const balance = await client.getBalance({ address: manager.address }).catch(() => null);
  const gasFloor = balance === null || balance < GAS_FLOOR_WEI;
  if (gasFloor) {
    await alertOwner(
      "manager gas below floor",
      balance === null
        ? "Manager balance read failed — treated as below floor (fail closed). Executions halted this window."
        : `Manager ${manager.address} holds ${(Number(balance) / 1e18).toFixed(6)} ETH; the floor is 0.001. Executions halted until funded.`,
    );
  }

  // ── receipt repair for prior unconfirmed sends. An unreadable ledger halts
  //    the window: "none pending" and "D1 down" must never look alike ──
  let repairs: RepairResult[] = [];
  let blocked = new Set<string>();
  try {
    ({ repairs, blocked } = await repairUnconfirmed(bySmart));
  } catch (err) {
    console.error("[auto-rebalance] ledger unreachable during repair", err);
    await alertOwner("run halted: ledger unreachable", `listUnconfirmed threw: ${msg(err)}. The window did not run.`);
    // No finish write: an unfinished run row is the store's documented crash
    // signal, and with D1 down the write would be lost anyway.
    return bail("ledger unreachable (repair)");
  }

  // ── notification repair: money that moved but whose owner was never told
  //    (a crash between the send and the end-of-pass loop). Runs every
  //    window, on- or off-session — a late note beats silence. ──
  for (const row of await listUnnotified()) {
    const lateUserId = bySmart.get(row.user.toLowerCase());
    if (!lateUserId) continue;
    const lateName = GROVES.find((g) => g.id === row.groveId)?.name ?? row.groveId;
    const read = row.veraReason !== undefined
      ? ` Vera's market read: ${displayReason({ action: "proceed", reason: row.veraReason, source: "model", lintOk: row.lintOk ?? false })}`
      : "";
    const delivered = await addNotification(lateUserId, {
      kind: "system",
      title: `${lateName} rebalanced`,
      body: `Your ${lateName} basket was realigned earlier (about $${(row.turnoverUsd ?? 0).toFixed(2)}, inside your caps) — this note is late, not the rebalance.${read} The transaction is in the grove's Rebalances list.`,
      txHash: row.txHash,
      at: Date.now(),
    });
    if (delivered) await markNotified(row.id);
  }

  const launched = GROVES.filter((g) => g.onChainId !== undefined);

  // One price sweep for every symbol any launched grove could touch. Total
  // failure surfaces per user as pricing-unavailable — never "no drift".
  const symbols = new Map<string, Asset>();
  for (const g of launched) for (const c of g.components) {
    const a = assetBySymbol(c.symbol);
    if (a) symbols.set(a.symbol, a);
  }
  let prices: Record<string, AssetPrice> = {};
  try {
    prices = await priceAllWithFallback(client, [...symbols.values()]);
  } catch (err) {
    errors.push(`pricing sweep failed: ${msg(err)}`);
  }
  const ctx: RunCtx = { prices, nowSeconds: Math.floor(Date.now() / 1000), bySmart, staleBlocked: 0, tilt: new Map() };

  let executed = 0;
  let plannedCount = 0;
  let simRefused = 0;
  // A send with no receipt queues every later manager nonce behind it — one
  // unconfirmed halts all remaining sends this window, INCLUDING one repair
  // just found still pending from a prior window (a new send would queue
  // behind that stuck nonce, hang its full 120s, and mint another unconfirmed
  // row). Halted users lose one window at most: their cooldown was never
  // consumed.
  let haltSends = blocked.size > 0;

  for (const def of launched) {
    let users: Address[];
    try {
      users = await optedInCandidates(def.onChainId!);
    } catch (err) {
      errors.push(`candidate scan failed for ${def.id}: ${msg(err)}`);
      await alertOwner("candidate scan failed", `${def.id}: ${msg(err)}`);
      continue;
    }

    // Phase 0: ONE active-weight decision per grove per window, before any
    // planning — every depositor holds the same strategy, so they get the same
    // targets and move together. This is what makes the vault actively managed
    // rather than drift-maintained: Vera moves the target, so the trade happens
    // when her view changes, not when the market happens to drift 5 points.
    //
    // It is bounded before it is used: clampWeights holds every weight inside
    // the published band and forces the sum, so the worst possible tilt is a
    // rearrangement of the same names. A model failure returns the published
    // weights and the window silently behaves exactly as it did before.
    ctx.tilt.set(def.id, await tiltFor(def));

    // Phase 1: plan EVERY eligible user — pure reads, no venue, no sends;
    // only executions count against the run cap (R10).
    const planned: PlannedUser[] = [];
    for (const user of users) {
      if (blocked.has(`${def.id}:${user.toLowerCase()}`)) {
        await record({ grove: def.id, user, outcome: "skipped", reason: "prior rebalance still unconfirmed" });
        continue;
      }
      try {
        const r = await planOne(def, user, ctx);
        if ("outcome" in r) await record(r);
        else planned.push(r);
      } catch (err) {
        console.error(`[auto-rebalance] plan failed ${def.id}/${user}`, err);
        await record({ grove: def.id, user, outcome: "failed", reason: msg(err) });
      }
    }
    if (!planned.length) continue;

    // R10: worst drift first, so whatever the cap trims is the least drifted
    // — and first in line next window by construction (drift only grows).
    planned.sort((a, b) => b.plan.maxDeviationBps - a.plan.maxDeviationBps);

    // Nothing below can execute → skip honestly, spend no LLM call on it.
    const skipAll = async (reason: string): Promise<void> => {
      for (const p of planned) await record({ grove: def.id, user: p.user, outcome: "skipped", reason });
    };
    if (gasFloor) {
      await skipAll("manager gas below floor");
      continue;
    }
    if (haltSends) {
      await skipAll("halted: earlier transaction unconfirmed");
      continue;
    }
    if (executed >= MAX_USERS_PER_RUN) {
      await skipAll("execution budget; next window");
      continue;
    }
    plannedCount += planned.length;

    // Phase 2: ONE verdict per grove per window — every depositor's basket is
    // the same strategy, so the timing call is grove-level and everyone moves
    // together (or waits together). Vera can only veto the math; her worst
    // failure mode is patience.
    const agg = new Map<string, JudgmentRow>();
    for (const p of planned) {
      for (const row of p.rows) {
        const prev = agg.get(row.symbol);
        if (!prev || Math.abs(row.deviationPct) > Math.abs(prev.deviationPct)) agg.set(row.symbol, row);
      }
    }
    const verdict = await judgeRebalance({
      groveName: def.name,
      turnoverUsd: planned.reduce((s, p) => s + p.plan.turnoverUsd, 0),
      maxDeviationBps: Math.max(...planned.map((p) => p.plan.maxDeviationBps)),
      rows: [...agg.values()],
    });
    if (verdict.action === "defer") {
      // The ledger takes the verdict verbatim plus the lint flag; anything a
      // user ever sees goes through displayReason() instead.
      const outcome: RebalanceOutcome = verdict.source === "outage" ? "defer-outage" : "defer-market";
      for (const p of planned) {
        await record({ grove: def.id, user: p.user, outcome, reason: verdict.reason, veraReason: verdict.reason, lintOk: verdict.lintOk });
      }
      console.log(`[auto-rebalance] ${def.id} deferred (${verdict.source}): ${displayReason(verdict)}`);
      continue;
    }

    // Phase 3: execute — same window, same reasoning, one depositor at a time.
    for (const p of planned) {
      if (haltSends) {
        await record({ grove: def.id, user: p.user, outcome: "skipped", reason: "halted: earlier transaction unconfirmed" });
        continue;
      }
      if (executed >= MAX_USERS_PER_RUN) {
        await record({ grove: def.id, user: p.user, outcome: "skipped", reason: "execution budget; next window" });
        continue;
      }
      executed += 1;
      let o: Outcome;
      try {
        o = await executeOne(def, p.user, manager, p.plan, verdict, ctx.prices, upsertCritical);
      } catch (err) {
        console.error(`[auto-rebalance] execute failed ${def.id}/${p.user}`, err);
        o = { grove: def.id, user: p.user, outcome: "failed", reason: msg(err), veraReason: verdict.reason, lintOk: verdict.lintOk };
      }
      await record(o);
      await renewLock();
      if (o.outcome === "unconfirmed") haltSends = true;
      if (o.outcome === "failed") await alertOwner("rebalance send failed", `${def.id}/${p.user}: ${o.reason}`);
      if (o.outcome === "skipped" && o.reason.startsWith(SIM_REFUSED)) simRefused += 1;
    }
  }

  // The user's own numbers first, then Vera's read attributed grove-level,
  // then the pointer. Chain-touching failures notify too; skips, defers, and
  // quiet windows never do — restraint lives in the panel, not the inbox.
  for (const o of outcomes) {
    const chainTouched = o.txHash !== undefined && (o.outcome === "failed" || o.outcome === "unconfirmed");
    if (o.outcome !== "rebalanced" && !chainTouched) continue;
    const userId = bySmart.get(o.user.toLowerCase());
    if (!userId) continue;
    const name = GROVES.find((g) => g.id === o.grove)?.name ?? o.grove;
    let delivered: boolean;
    if (o.outcome === "rebalanced") {
      const read = o.veraReason !== undefined
        ? ` Vera's market read: ${displayReason({ action: "proceed", reason: o.veraReason, source: "model", lintOk: o.lintOk ?? false })}`
        : "";
      delivered = await addNotification(userId, {
        kind: "system",
        title: `${name} rebalanced`,
        body: `Your ${name} basket: about $${(o.turnoverUsd ?? 0).toFixed(2)} realigned toward its published weights. Price-checked on-chain, as always.${read} The transaction is in the grove's Rebalances list.`,
        txHash: o.txHash,
        at: Date.now(),
      });
    } else if (o.outcome === "unconfirmed") {
      delivered = await addNotification(userId, {
        kind: "system",
        title: `${name} rebalance pending`,
        body: `A rebalance for your ${name} basket was sent but hasn't confirmed yet. The next pass checks the receipt and follows up either way.`,
        txHash: o.txHash,
        at: Date.now(),
      });
    } else {
      delivered = await addNotification(userId, {
        kind: "system",
        title: `${name} rebalance did not complete`,
        body: `A rebalance for your ${name} basket reverted on-chain — nothing moved. The next pass will look again.`,
        txHash: o.txHash,
        at: Date.now(),
      });
    }
    // notified records DELIVERY, nothing else — an undelivered rebalanced row
    // stays notified=0 for the next window's listUnnotified sweep, and §6
    // metric 2 can actually catch a silent move.
    const id = ledgerIds.get(o);
    if (delivered && id !== undefined) await markNotified(id);
  }

  // Strategy §4 severity ladder: refusals past 30% of planned is RED — a
  // third of a window refusing means driver and contract disagree
  // systematically, not statistically.
  if (plannedCount > 0 && simRefused * 10 > plannedCount * 3) {
    await alertOwner(
      "simulation refusals above 30% of planned",
      `${simRefused} of ${plannedCount} planned users refused simulation this pass — driver and contract may disagree systematically.`,
    );
  }

  const gate: RunGate = gasFloor ? "gas-floor" : ctx.staleBlocked > 0 && plannedCount === 0 ? "stale-feeds" : "acted";
  await recordRunFinish(runId, { startedAt, finishedAt: Date.now(), gate, counts: countBy(outcomes), error: errors.join("; ") || undefined });
  await pruneLedger();
  const summary = Object.entries(countBy(outcomes)).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`[auto-rebalance] ${runId} gate=${gate} ${summary || "nothing to do"}`);
  return { ran: true, runId, gate, outcomes, repairs };
}
