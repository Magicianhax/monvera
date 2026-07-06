// Demo data for the marketing-site app preview. Feeds the REAL Monvera screens
// believable values without auth, chain reads, or AI calls. Only ever used under
// <DemoProvider> (the /demo route + landing phones); the production app never
// imports the provider, so this has zero effect on real behaviour.
import { parseUnits } from "viem";
import { ALL_ASSETS, type Asset } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import type { Holding } from "@/hooks/useBalances";
import type { ActivityRow, VeraRecord } from "@/lib/onchainHistory";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";
import type { Allocation } from "@/lib/allocation-schema";

export const DEMO_ADDRESS = "0x5742a0d3b9c8417be5d8ae7c6cb0f2f3a1b2c3d4" as const;

function assetOf(symbol: string): Asset {
  const a = ALL_ASSETS.find((x) => x.symbol === symbol);
  if (!a) throw new Error(`demo: unknown asset ${symbol}`);
  return a;
}

function holding(symbol: string, valueUsd: number): Holding {
  const asset = assetOf(symbol);
  const dec = asset.decimals ?? 18;
  const d = displayFor(symbol);
  const priceUsd = d.price ?? 1;
  const qty = valueUsd / priceUsd;
  const raw = parseUnits(qty.toFixed(Math.min(dec, 6)), dec);
  return { asset, raw, qty, valueUsd, priceUsd, dayChangePct: d.day, spark: d.spark };
}

// ~$2,512 invested across four holdings + ~$240 spendable cash.
const DEMO_HOLDINGS: Holding[] = [
  holding("SPY", 880.05),
  holding("AAPL", 642.18),
  holding("NVDA", 511.4),
  holding("SGOV", 478.37),
];

const DEMO_INVESTED = DEMO_HOLDINGS.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

export const DEMO_USDC = { raw: parseUnits("240.55", 6), value: 240.55 };

export const DEMO_PORTFOLIO = {
  holdings: DEMO_HOLDINGS,
  investedUsd: DEMO_INVESTED,
  cashUsd: DEMO_USDC.value,
  totalUsd: DEMO_INVESTED + DEMO_USDC.value,
};

const hx = (tag: string): `0x${string}` => ("0x" + tag.repeat(32).slice(0, 64)) as `0x${string}`;

export const DEMO_ACTIVITY: ActivityRow[] = [
  { kind: "invest", usdc: 300, legCount: 4, txHash: hx("7b41a9c0"), blockNumber: BigInt(0) },
  { kind: "invest", usdc: 150, legCount: 3, txHash: hx("910e7f22"), blockNumber: BigInt(0) },
  { kind: "invest", usdc: 500, legCount: 4, txHash: hx("a27c1043"), blockNumber: BigInt(0) },
];

// Vera's track record (the Vera screen's stat band + recorded recommendations).
export const DEMO_VERA_RECORD: VeraRecord = {
  totalRecommendations: 24,
  totalExecutedUsd: 18450,
  executedCount: 19,
  recentRecommendations: [
    { planId: hx("a1b2c3d4"), riskScore: 4200, usdcSpent: 300, txHash: hx("7b41a9c0"), blockNumber: BigInt(0) },
    { planId: hx("b2c3d4e5"), riskScore: 6100, usdcSpent: 100, txHash: hx("910e7f22"), blockNumber: BigInt(0) },
    { planId: hx("c3d4e5f6"), riskScore: 2600, usdcSpent: 500, txHash: hx("a27c1043"), blockNumber: BigInt(0) },
  ],
};

// A canned, risk-aware allocation (no AI call). Weights always sum to 100.
export function demoAllocate(goal: string, amountUsd: number, risk?: string): AllocateResult {
  const base =
    risk === "conservative"
      ? [
          { symbol: "SPY", weightPct: 35, reason: "The whole US market in one steady holding." },
          { symbol: "AAPL", weightPct: 20, reason: "A profitable giant that holds up well." },
          { symbol: "NVDA", weightPct: 15, reason: "A measured slice of the AI leader." },
          { symbol: "SGOV", weightPct: 30, reason: "A calm dollar cushion that still earns." },
        ]
      : risk === "aggressive"
        ? [
            { symbol: "NVDA", weightPct: 40, reason: "Leads the AI boom, with bigger swings." },
            { symbol: "AAPL", weightPct: 25, reason: "A profitable anchor for the basket." },
            { symbol: "SPY", weightPct: 25, reason: "Broad market to spread the risk." },
            { symbol: "SGOV", weightPct: 10, reason: "A small safety cushion." },
          ]
        : [
            { symbol: "NVDA", weightPct: 30, reason: "Leads the AI boom." },
            { symbol: "AAPL", weightPct: 25, reason: "A steady, profitable giant." },
            { symbol: "SPY", weightPct: 25, reason: "The whole US market in one holding." },
            { symbol: "SGOV", weightPct: 20, reason: "A calm dollar cushion that still earns." },
          ];
  const riskScore = risk === "conservative" ? 2600 : risk === "aggressive" ? 6200 : 4200;
  return {
    summary: "A balanced mix that grows over time and keeps some safe.",
    rationale:
      "Most of the money goes into names you know, with a slice kept in steady dollars so a rough week doesn't sting as much. You can nudge it safer or bolder anytime.",
    riskScore,
    allocations: base,
    amountUsd,
    model: "demo",
  };
}

export function demoSuccess(alloc: Allocation, amountUsd: number): InvestSuccess {
  return {
    txHash: hx("e1f0a1b2"),
    amountUsd,
    holdings: alloc.allocations.map((a) => ({
      symbol: a.symbol,
      name: a.symbol,
      weightPct: a.weightPct,
      amountUsd: (amountUsd * a.weightPct) / 100,
    })),
  };
}
