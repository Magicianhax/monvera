import "server-only";

// The auto-manage driver: the six-hourly pass that turns signed consent into
// actual rebalances. For every launched grove it
//
//   1. finds who ever opted in (AutoEnabled events, Blockscout v2) and keeps
//      only those still enabled, off cooldown, and with budget left,
//   2. reads their position + live prices and asks the pure planner
//      (rebalancePlan.ts) whether the basket has genuinely drifted,
//   3. asks Vera whether NOW is the window (rebalanceJudgment.ts) — the model
//      can only veto a plan the math justified, and every failure defers,
//   4. quotes the legs on Kyber exactly like a grove buy (the CONTRACT is
//      sender and recipient — it executes and measures every leg itself),
//   5. SIMULATES managedRebalance as the manager — one call proves the oracle
//      bands, the caps, the cooldown, and the allowances all hold — and only
//      then sends it, signed by the manager hot key,
//   6. notifies the user (with Vera's one-sentence why); the Rebalances panel
//      picks the event up on its own.
//
// The contract is the enforcement layer (per-token fraction, oracle-valued
// turnover, lifetime budget — AutoConfig); everything here is merely polite:
// it plans small, checks first, and logs loud. Nothing in this file is
// trusted by the chain.
import { createPublicClient, createWalletClient, encodeEventTopics, erc20Abi, http, parseAbi, parseAbiItem, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, EXPLORER_URL } from "@/lib/chain";
import { GROVES, type GroveDef } from "@/lib/groves";
import { ALL_ASSETS, assetBySymbol, USDG, MULTICALL3, type Asset } from "@/lib/tokens";
import { SERVER_RPC_URL } from "./rpc";
import { priceAllWithFallback } from "./pricing";
import { kyberQuote } from "./kyber";
import { GROVE_MANAGER, GROVE_LEG_SLIPPAGE_BPS } from "./groveQuote";
import { computeRebalancePlan, type PlanHolding, type PlanTarget } from "./rebalancePlan";
import { judgeRebalance } from "./rebalanceJudgment";
import { addNotification } from "./notifyStore";
import { listRecentUsers } from "./userDirectory";

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
/** Bound one run's work; anything past this waits for the next hour. Logged,
 *  never silent. */
const MAX_USERS_PER_RUN = 20;
const DEADLINE_SECONDS = 600;

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
  action: "rebalanced" | "skipped" | "failed";
  reason: string;
  txHash?: `0x${string}`;
  turnoverUsd?: number;
  /** Vera's one-sentence timing rationale — shown to the user, so it must be honest. */
  veraReason?: string;
}

export interface AutoRebalanceReport {
  ran: boolean;
  reason?: string;
  outcomes: Outcome[];
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

async function rebalanceOne(
  def: GroveDef,
  user: Address,
  manager: ReturnType<typeof privateKeyToAccount>,
  prices: Record<string, { priceUsd?: number } | undefined>,
): Promise<Outcome> {
  const groveId = BigInt(def.onChainId!);
  const managerAddr = GROVE_MANAGER as Address;
  const skip = (reason: string): Outcome => ({ grove: def.id, user, action: "skipped", reason });

  const [enabled, maxPerBuy, maxTotal, moved, cooldown, lastAction, fractionBps] = await client.readContract({
    address: managerAddr,
    abi: ABI,
    functionName: "autoConfigs",
    args: [user, groveId],
  });
  if (!enabled) return skip("consent revoked");
  const now = Math.floor(Date.now() / 1000);
  if (lastAction !== BigInt(0) && now < Number(lastAction) + Number(cooldown)) return skip("cooldown");
  const remainingUsd = Number(maxTotal - moved) / 1e6;
  const perActionUsd = Number(maxPerBuy) / 1e6;
  const maxTurnoverUsd = Math.min(perActionUsd, remainingUsd) * CAP_HAIRCUT;
  if (maxTurnoverUsd < 15) return skip("lifetime budget exhausted");

  const [costBasis, tokens, amounts] = await client.readContract({
    address: managerAddr,
    abi: ABI,
    functionName: "positionOf",
    args: [user, groveId],
  });
  if (costBasis === BigInt(0)) return skip("no position");

  // Standing allowances bound what a sell leg may pull — read them up front so
  // the planner never plans a pull the transferFrom would revert.
  const held = tokens.map((t, i) => ({ token: t, amountRaw: amounts[i] })).filter((x) => x.amountRaw > BigInt(0));
  if (!held.length) return skip("empty position");
  const allowances = await Promise.all(
    held.map((x) =>
      client.readContract({ address: x.token, abi: erc20Abi, functionName: "allowance", args: [user, managerAddr] }),
    ),
  );

  const holdings: PlanHolding[] = [];
  for (let i = 0; i < held.length; i++) {
    const asset = byAddress.get(held[i].token.toLowerCase());
    if (!asset) return skip(`unknown token ${held[i].token} in position`);
    holdings.push({
      token: held[i].token,
      symbol: asset.symbol,
      amountRaw: held[i].amountRaw,
      sellableRaw: allowances[i] < held[i].amountRaw ? allowances[i] : held[i].amountRaw,
      priceUsd: prices[asset.symbol]?.priceUsd ?? 0,
      targetWeightBps: def.components.find((c) => c.symbol === asset.symbol)?.weightBps ?? 0,
    });
  }
  const missing: PlanTarget[] = def.components
    .filter((c) => !holdings.some((hh) => hh.symbol === c.symbol))
    .map((c) => ({ token: assetBySymbol(c.symbol)!.address as Address, symbol: c.symbol, targetWeightBps: c.weightBps }));

  const plan = computeRebalancePlan(holdings, missing, { maxTurnoverUsd, maxFractionBps: Number(fractionBps) }, { driftTriggerBps: DRIFT_TRIGGER_BPS });
  if (!plan) return skip("no drift worth acting on");

  // The math says the rebalance is justified; Vera decides whether NOW is the
  // window (a drift mid-storm waits rather than churns). She can only veto —
  // never initiate, enlarge, or redirect — and every failure defers.
  const totalUsd = holdings.reduce((s, x) => s + (Number(x.amountRaw) / 1e18) * x.priceUsd, 0);
  const touched = new Set([...plan.sells.map((s) => s.symbol), ...plan.buys.map((b) => b.symbol)]);
  const verdict = await judgeRebalance({
    groveName: def.name,
    turnoverUsd: plan.turnoverUsd,
    maxDeviationBps: plan.maxDeviationBps,
    rows: [...touched].map((symbol) => {
      const hh = holdings.find((x) => x.symbol === symbol);
      const currentPct = hh ? (((Number(hh.amountRaw) / 1e18) * hh.priceUsd) / totalUsd) * 100 : 0;
      const targetPct = (def.components.find((c) => c.symbol === symbol)?.weightBps ?? 0) / 100;
      return { symbol, currentWeightPct: currentPct, targetWeightPct: targetPct, deviationPct: currentPct - targetPct };
    }),
  });
  if (verdict.action === "defer") return skip(`Vera deferred: ${verdict.reason}`);

  // ── quote the legs, sells first (they fund the pool the buys spend) ──
  type Leg = { tokenIn: Address; tokenOut: Address; amountIn: bigint; minOut: bigint; callTarget: Address; approvalTarget: Address; data: `0x${string}` };
  const legs: Leg[] = [];
  let pool = BigInt(0);
  for (const s of plan.sells) {
    const q = await kyberQuote(s.token, USDG.address as Address, s.amountRaw, managerAddr, managerAddr, "none", GROVE_LEG_SLIPPAGE_BPS);
    if (!q || q.minBuyAmount <= BigInt(0)) return skip(`no sell route for ${s.symbol}`);
    const router = q.steps[1].to;
    legs.push({ tokenIn: s.token, tokenOut: USDG.address as Address, amountIn: s.amountRaw, minOut: q.minBuyAmount, callTarget: router, approvalTarget: router, data: q.steps[1].data });
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
    return skip(`simulation refused: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }

  const wallet = createWalletClient({ account: manager, chain, transport: http(SERVER_RPC_URL) });
  try {
    const hash = await wallet.writeContract({
      address: managerAddr,
      abi: ABI,
      functionName: "managedRebalance",
      args: [user, groveId, legs, deadline],
    });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") {
      console.error(`[auto-rebalance] reverted on-chain ${def.id}/${user}`, hash);
      return { grove: def.id, user, action: "failed", reason: "reverted on-chain", txHash: hash };
    }
    return { grove: def.id, user, action: "rebalanced", reason: `drift ${plan.maxDeviationBps}bps`, txHash: hash, turnoverUsd: plan.turnoverUsd, veraReason: verdict.reason };
  } catch (err) {
    console.error(`[auto-rebalance] send failed ${def.id}/${user}`, err);
    return { grove: def.id, user, action: "failed", reason: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

export async function runAutoRebalance(): Promise<AutoRebalanceReport> {
  if (!GROVE_MANAGER) return { ran: false, reason: "GROVE_MANAGER unset", outcomes: [] };
  const key = process.env.GROVE_MANAGER_KEY;
  if (!key) return { ran: false, reason: "GROVE_MANAGER_KEY unset", outcomes: [] };
  const manager = privateKeyToAccount(key as `0x${string}`);

  const paused = await client.readContract({ address: GROVE_MANAGER as Address, abi: ABI, functionName: "paused" }).catch(() => true);
  if (paused) return { ran: false, reason: "contract paused", outcomes: [] };

  const launched = GROVES.filter((g) => g.onChainId !== undefined);
  const outcomes: Outcome[] = [];
  let budget = MAX_USERS_PER_RUN;

  // One price sweep for every symbol any launched grove could touch.
  const symbols = new Map<string, Asset>();
  for (const g of launched) for (const c of g.components) {
    const a = assetBySymbol(c.symbol);
    if (a) symbols.set(a.symbol, a);
  }
  const prices = await priceAllWithFallback(client, [...symbols.values()]).catch(
    () => ({}) as Awaited<ReturnType<typeof priceAllWithFallback>>,
  );

  for (const def of launched) {
    let users: Address[];
    try {
      users = await optedInCandidates(def.onChainId!);
    } catch (err) {
      console.error(`[auto-rebalance] candidate scan failed for ${def.id}`, err);
      outcomes.push({ grove: def.id, user: "0x0" as Address, action: "skipped", reason: "candidate scan failed" });
      continue;
    }
    for (const user of users) {
      if (budget <= 0) {
        console.warn(`[auto-rebalance] user budget hit (${MAX_USERS_PER_RUN}); remaining wait for the next run`);
        break;
      }
      budget--;
      try {
        outcomes.push(await rebalanceOne(def, user, manager, prices));
      } catch (err) {
        console.error(`[auto-rebalance] unexpected failure ${def.id}/${user}`, err);
        outcomes.push({ grove: def.id, user, action: "failed", reason: err instanceof Error ? err.message.split("\n")[0] : String(err) });
      }
    }
  }

  // Tell each rebalanced user what happened, in their own inbox. The smart
  // account is the position owner; the directory maps it back to the person.
  const rebalanced = outcomes.filter((o) => o.action === "rebalanced");
  if (rebalanced.length) {
    const directory = await listRecentUsers(365, 2000).catch(() => []);
    const bySmart = new Map(directory.filter((d) => d.smartAddress).map((d) => [d.smartAddress!.toLowerCase(), d.userId]));
    for (const o of rebalanced) {
      const userId = bySmart.get(o.user.toLowerCase());
      if (!userId) continue;
      const def = GROVES.find((g) => g.id === o.grove);
      await addNotification(userId, {
        kind: "system",
        title: `${def?.name ?? o.grove} rebalanced`,
        body:
          `Auto-manage realigned your basket toward its published weights (about $${(o.turnoverUsd ?? 0).toFixed(2)} moved, inside your caps).` +
          (o.veraReason ? ` ${o.veraReason}` : "") +
          " The transaction is in the grove's Rebalances list.",
        txHash: o.txHash,
        at: Date.now(),
      }).catch(() => {});
    }
  }

  console.log(
    `[auto-rebalance] ${outcomes.filter((o) => o.action === "rebalanced").length} rebalanced, ` +
      `${outcomes.filter((o) => o.action === "skipped").length} skipped, ` +
      `${outcomes.filter((o) => o.action === "failed").length} failed`,
  );
  return { ran: true, outcomes };
}
