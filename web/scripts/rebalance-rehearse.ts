// Rehearse a REAL rebalance against a REAL position, without spending a cent.
//
//   npx tsx --conditions=react-server scripts/rebalance-rehearse.ts <address> [SYMBOL] [movePct]
//   npx tsx --conditions=react-server scripts/rebalance-rehearse.ts 0xb7c9… NVDA 45
//
// Why this exists: the trigger is 500 bps of drift, and on an 8-name mega-cap
// basket that needs ONE name to move roughly 40-54% relative to the rest. So
// the happy path — planner produces legs, Vera judges the window, the ledger
// records "rebalanced", the holder gets a notification — can sit unexercised
// for weeks after launch, which is exactly when you least want its first run
// to be its first test.
//
// This reads the live position from the chain, applies a hypothetical price
// move to one holding, then runs the SAME planner and the SAME judgment the
// cron uses, and prints the legs, the verdict and the copy a holder would see.
// It never signs, never sends, and never writes to the ledger.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, formatUnits } from "viem";
import { computeRebalancePlan } from "../src/lib/server/rebalancePlan";
import { judgeRebalance, displayReason } from "../src/lib/server/rebalanceJudgment";
import { toCheckRow } from "../src/lib/server/groveChecks";
import { GROVES } from "../src/lib/groves";
import { assetBySymbol } from "../src/lib/tokens";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}


async function main() {
const [address, shockSymbol = "NVDA", movePctRaw = "45"] = process.argv.slice(2);
if (!address) throw new Error("usage: rebalance-rehearse <address> [SYMBOL] [movePct]");
const movePct = Number(movePctRaw);

const MANAGER = process.env.NEXT_PUBLIC_GROVE_MANAGER as `0x${string}`;
const grove = GROVES.find((g) => g.id === "titan")!;
const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });

const POSITION_ABI = [
  {
    type: "function",
    name: "positionOf",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }],
  },
] as const;

const [, tokens, amounts] = await client.readContract({
  address: MANAGER,
  abi: POSITION_ABI,
  functionName: "positionOf",
  args: [address as `0x${string}`, BigInt(grove.onChainId!)],
});

// Live prices, from the same public summary the app uses.
const { summary } = (await (
  await fetch("https://monvera.best/api/market", { headers: { "user-agent": "monvera/1.0" } })
).json()) as { summary: Record<string, { spark?: number[] }> };
const livePrice = (s: string) => {
  const spark = summary[s]?.spark;
  if (!spark?.length) throw new Error(`no live price for ${s}`);
  return spark[spark.length - 1];
};

const holdings = tokens.map((token, i) => {
  const comp = grove.components.find(
    (c) => assetBySymbol(c.symbol)?.address.toLowerCase() === token.toLowerCase(),
  );
  if (!comp) throw new Error(`token ${token} is not in the registry composition`);
  const shocked = comp.symbol === shockSymbol ? 1 + movePct / 100 : 1;
  return {
    token,
    symbol: comp.symbol,
    amountRaw: amounts[i],
    sellableRaw: amounts[i], // the driver clamps by allowance/balance; both are full here
    priceUsd: livePrice(comp.symbol) * shocked,
    targetWeightBps: comp.weightBps,
  };
});

const total = holdings.reduce((s, h) => s + (Number(formatUnits(h.amountRaw, 18)) * h.priceUsd), 0);
console.log(`\nposition ${address.slice(0, 10)}  ${holdings.length} names  $${total.toFixed(2)}`);
console.log(`hypothetical: ${shockSymbol} ${movePct >= 0 ? "+" : ""}${movePct}%\n`);
for (const h of holdings.sort((a, b) => b.targetWeightBps - a.targetWeightBps)) {
  const v = Number(formatUnits(h.amountRaw, 18)) * h.priceUsd;
  const w = (v / total) * 100;
  const dev = w - h.targetWeightBps / 100;
  console.log(
    `  ${h.symbol.padEnd(6)} ${w.toFixed(2)}% vs ${(h.targetWeightBps / 100).toFixed(0)}%  ${dev >= 0 ? "+" : ""}${dev.toFixed(2)}pp${h.symbol === shockSymbol ? "   <- shocked" : ""}`,
  );
}

// The REAL planner, with the REAL caps a managed vault signs.
const plan = computeRebalancePlan(
  holdings,
  [],
  { maxTurnoverUsd: total, maxFractionBps: 10_000 },
  { driftTriggerBps: 500 },
);

if (!plan) {
  console.log("\nplanner: NO ACTION (drift under the trigger, or nothing worth moving)");
  console.log("ledger would record: no-drift");
  return;
}

console.log(`\nplanner: ACTIONABLE  worst drift ${(plan.maxDeviationBps / 100).toFixed(2)}pp  turnover $${plan.turnoverUsd.toFixed(2)}`);
for (const s of plan.sells) console.log(`   SELL ${s.symbol.padEnd(6)} $${s.valueUsd.toFixed(2)}`);
for (const b of plan.buys) console.log(`   BUY  ${b.symbol.padEnd(6)} ${(b.share * 100).toFixed(1)}% of proceeds`);

// The REAL judgment — one live model call, the same one the cron makes.
const verdict = await judgeRebalance({
  groveName: grove.name,
  rows: holdings.map((h) => ({
    symbol: h.symbol,
    currentWeightPct: ((Number(formatUnits(h.amountRaw, 18)) * h.priceUsd) / total) * 100,
    targetWeightPct: h.targetWeightBps / 100,
    deviationPct: ((Number(formatUnits(h.amountRaw, 18)) * h.priceUsd) / total) * 100 - h.targetWeightBps / 100,
  })),
  turnoverUsd: plan.turnoverUsd,
  maxDeviationBps: plan.maxDeviationBps,
});

console.log(`\nVera: ${verdict.action.toUpperCase()}   source=${verdict.source}  lintOk=${verdict.lintOk}`);
console.log(`  reason stored : ${verdict.reason}`);
console.log(`  reason SHOWN  : ${displayReason(verdict)}`);

const outcome = verdict.action === "proceed" ? "rebalanced" : verdict.source === "outage" ? "defer-outage" : "defer-market";
const row = toCheckRow({
  id: 0,
  runId: "rehearsal",
  groveId: grove.id,
  user: address.toLowerCase(),
  outcome,
  reason: verdict.reason,
  veraReason: verdict.reason,
  lintOk: verdict.lintOk,
  notified: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
console.log(`\npanel row would read:\n  ${row.title}\n  ${row.detail}`);
console.log(`\nledger outcome: ${outcome}`);
console.log("\nnothing was signed, sent, or written.");

}

main();
