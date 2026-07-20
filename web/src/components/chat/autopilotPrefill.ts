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
// The adopted-plan slot NOTIFIES, it doesn't just store. ChatCenter used to
// drain it in a mount-only effect, so a scan adopted while a chat session was
// already open landed in the slot and stayed there — the button did nothing.
// Subscribers are called on every set, so the handoff works whether or not the
// chat is already mounted.
let adoptSlot: AdoptedPlan | null = null;
const adoptListeners = new Set<() => void>();

export function setAdoptedPlan(p: AdoptedPlan) {
  adoptSlot = p;
  for (const fn of [...adoptListeners]) {
    try {
      fn();
    } catch {
      /* one bad listener must not swallow the handoff for the others */
    }
  }
}
export function consumeAdoptedPlan(): AdoptedPlan | null {
  const p = adoptSlot;
  adoptSlot = null;
  return p;
}
/** Subscribe to adoptions. Returns an unsubscribe fn. */
export function onAdoptedPlan(fn: () => void): () => void {
  adoptListeners.add(fn);
  return () => {
    adoptListeners.delete(fn);
  };
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
