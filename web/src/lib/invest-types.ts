// Shared client-side types for the allocate -> plan -> send flow.
// These mirror the JSON the API routes return (all bigints serialized as strings).
import type { Allocation } from "./allocation-schema";

/** Backtest stats for one line (the plan or the benchmark). */
export interface BacktestSeries {
  returnPct: number;
  volPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  /** Equity curve normalized to 100, downsampled. */
  curve: number[];
}

/** 12-month real-history simulation of the proposed mix (see lib/server/quant). */
export interface BacktestResult {
  period: "1Y";
  rebalance: "monthly";
  coveragePct: number;
  excluded: string[];
  portfolio: BacktestSeries;
  benchmark: BacktestSeries & { symbol: "SPY" };
}

/** POST /api/allocate response. */
export interface AllocateResult extends Allocation {
  amountUsd: number;
  model: string;
  /** Null when too little of the basket has public history (never faked). */
  backtest?: BacktestResult | null;
}

/** A receipt-ish summary surfaced to the success screen. */
export interface InvestSuccess {
  /** The on-chain record tx (VeraRecord) when it ran, else the last filled buy. */
  txHash: `0x${string}`;
  /** Each buy is its own sponsored UserOp now (not a bundle), so every holding
      carries its own Blockscout receipt — surfaced per-row on the success screen. */
  holdings: { symbol: string; name: string; weightPct: number; amountUsd: number; txHash?: `0x${string}` }[];
  amountUsd: number;
  /** The on-chain AI verification this plan passed (for the "Verified on-chain" panel). */
  verification?: {
    riskScore: number; // assessed portfolio risk, bps
    maxRisk: number; // ceiling the agent signed off on, bps
    planId: `0x${string}`;
    agentId: string;
    signature: `0x${string}`;
  };
}
