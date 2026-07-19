"use client";

// One-shot handoff from chat to the Autopilot canvas: when Vera collects the
// user's amount/cadence/risk in conversation, she stashes them here and opens
// the canvas, which consumes them as its initial form values. Deliberately not
// state — a single module-level slot, read once.
export interface AutopilotPrefill {
  amountUsd: number;
  cadence: "daily" | "weekly" | "biweekly" | "monthly";
  risk: "careful" | "balanced" | "bolder";
}

let slot: AutopilotPrefill | null = null;

export function setAutopilotPrefill(p: AutopilotPrefill) {
  slot = p;
}

// ── scan → chat: the adopted basket, structured, weights intact ──────────────
// The scan result used to be stringified into a sentence and re-enter the LLM
// planner, which re-invented the basket. This slot hands the EXACT mix over.
export interface AdoptedPlan {
  brand: string;
  connections: { symbol: string; weightPct: number; reason: string }[];
}
let adoptSlot: AdoptedPlan | null = null;
export function setAdoptedPlan(p: AdoptedPlan) {
  adoptSlot = p;
}
export function consumeAdoptedPlan(): AdoptedPlan | null {
  const p = adoptSlot;
  adoptSlot = null;
  return p;
}

export function consumeAutopilotPrefill(): AutopilotPrefill | null {
  const p = slot;
  slot = null;
  return p;
}

// Same one-shot handoff for order tickets: when Vera opens a buy/sell with a
// stated amount ("buy $25 of AAPL"), the ticket consumes it as its initial $.
let orderAmount: number | null = null;

export function setOrderAmountPrefill(usd: number) {
  orderAmount = usd;
}

export function consumeOrderAmountPrefill(): number | null {
  const v = orderAmount;
  orderAmount = null;
  return v;
}
