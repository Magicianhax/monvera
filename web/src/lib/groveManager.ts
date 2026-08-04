"use client";

// Client-side GroveManager: the ABI slice the app actually calls, plus the
// builder that turns a server quote into the one sponsored UserOp that buys a
// basket.
//
// Custody note, because it drives everything here: GroveManager keys positions
// on `msg.sender`. Under ERC-4337 that is the SMART ACCOUNT, not the Privy EOA.
// So the basket, the cost basis, and the address `exit` later pulls from are all
// the smart account — while ordinary trades deliver to the EOA. Any balance or
// position read for a grove must use the smart account address.
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import type { Call } from "./aa";
import { ERC20_MINI_ABI } from "./monveraToken";
import { USDG } from "./tokens";

/** Deployed GroveManager, or "" while groves are not live (preview mode). */
export const GROVE_MANAGER = (process.env.NEXT_PUBLIC_GROVE_MANAGER || "") as Address | "";

export const GROVE_MANAGER_ABI = parseAbi([
  "struct SwapLeg { address tokenIn; address tokenOut; uint256 amountIn; uint256 minOut; address callTarget; address approvalTarget; bytes data; }",
  "function buy(uint256 groveId, SwapLeg[] legs, uint256 deadline)",
  "function exit(uint256 groveId, SwapLeg[] legs, uint16 fractionBps, uint256 deadline)",
  "function closePosition(uint256 groveId)",
  "function enableAuto(uint256 groveId, uint256 maxPerBuyUsdg, uint256 maxTotalUsdg, uint256 minSecondsBetween, uint16 maxRebalanceFractionBps)",
  "function revokeAuto(uint256 groveId)",
  "function autoConfigs(address user, uint256 groveId) view returns (bool enabled, uint256 maxPerBuyUsdg, uint256 maxTotalUsdg, uint256 managerMovedUsdg, uint256 minSecondsBetween, uint256 lastManagerAction, uint16 maxRebalanceFractionBps)",
  "function positionOf(address user, uint256 groveId) view returns (uint256 costBasisUsdg, address[] tokens, uint256[] amounts)",
  "function paused() view returns (bool)",
  "function callTargetAllowed(address) view returns (bool)",
  "function approvalTargetAllowed(address) view returns (bool)",
  "function feedOf(address) view returns (address aggregator, uint32 heartbeat, uint8 scalePow)",
]);

/** A leg exactly as /api/groves/quote returns it (bigints as strings). */
export interface GroveLegJson {
  symbol: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  minOut: string;
  expectedOut: string;
  callTarget: Address;
  approvalTarget: Address;
  data: Hex;
  venue: string;
}

export interface GroveBuyQuoteJson {
  groveId: string;
  onChainId: number;
  groveManager: Address;
  legs: GroveLegJson[];
  totalInUsdg: string;
  deadline: number;
  skipped: { symbol: string; reason: string }[];
}

/** The tuple shape viem encodes for SwapLeg — order matters, not names. */
function toSwapLeg(l: GroveLegJson) {
  return {
    tokenIn: l.tokenIn,
    tokenOut: l.tokenOut,
    amountIn: BigInt(l.amountIn),
    minOut: BigInt(l.minOut),
    callTarget: l.callTarget,
    approvalTarget: l.approvalTarget,
    data: l.data,
  };
}

/** `buy(...)` calldata for a quote. Exported so a caller can simulate it first. */
export function encodeGroveBuy(quote: GroveBuyQuoteJson): Hex {
  return encodeFunctionData({
    abi: GROVE_MANAGER_ABI,
    functionName: "buy",
    args: [BigInt(quote.onChainId), quote.legs.map(toSwapLeg), BigInt(quote.deadline)],
  });
}

export interface GroveExitLegJson {
  symbol: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  minOut: string;
  expectedOut: string;
  callTarget: Address;
  approvalTarget: Address;
  data: Hex;
  venue: string;
}

export interface GroveExitQuoteJson {
  groveId: string;
  onChainId: number;
  groveManager: Address;
  fractionBps: number;
  legs: GroveExitLegJson[];
  basisWithdrawnUsdg: string;
  minProceedsUsdg: string;
  expectedProceedsUsdg: string;
  estimatedFeeUsdg: string;
  deadline: number;
}

/** `exit(...)` calldata for a quote. */
export function encodeGroveExit(quote: GroveExitQuoteJson): Hex {
  return encodeFunctionData({
    abi: GROVE_MANAGER_ABI,
    functionName: "exit",
    args: [
      BigInt(quote.onChainId),
      quote.legs.map((l) => ({
        tokenIn: l.tokenIn,
        tokenOut: l.tokenOut,
        amountIn: BigInt(l.amountIn),
        minOut: BigInt(l.minOut),
        callTarget: l.callTarget,
        approvalTarget: l.approvalTarget,
        data: l.data,
      })),
      quote.fractionBps,
      BigInt(quote.deadline),
    ],
  });
}

/**
 * The sponsored batch for a grove exit: one ERC-20 approve per token, then the
 * exit itself.
 *
 * `exit` pulls each stock token FROM `msg.sender` — the smart account, which is
 * where the basket has been sitting since the buy. No permit signature is
 * needed here, unlike a buy: the smart account IS the caller, so it can approve
 * directly inside the same UserOp. Approvals are exact-amount and consumed in
 * the same transaction, so no standing allowance is left behind.
 *
 * Proceeds, minus the fee on any profit, land back in the smart account.
 */
export function buildGroveExitCalls(quote: GroveExitQuoteJson): Call[] {
  return [
    ...quote.legs.map((l) => ({
      to: l.tokenIn,
      data: encodeFunctionData({
        abi: ERC20_MINI_ABI,
        functionName: "approve" as const,
        args: [quote.groveManager, BigInt(l.amountIn)],
      }),
    })),
    { to: quote.groveManager, data: encodeGroveExit(quote) },
  ];
}

/**
 * The emergency hatch, as one sponsored call: zero the smart account's
 * accounting for a grove WITHOUT selling anything. The contract charges no fee
 * and moves no tokens — it exists for the case where part of the basket already
 * left the wallet (sold through the ordinary flows), which makes a full exit
 * physically impossible. Works even while the contract is paused.
 */
export function buildClosePositionCall(onChainId: number): Call {
  return {
    to: GROVE_MANAGER as Address,
    data: encodeFunctionData({
      abi: GROVE_MANAGER_ABI,
      functionName: "closePosition",
      args: [BigInt(onChainId)],
    }),
  };
}

/** The four hard caps a user consents to when switching auto-manage on. All
 *  enforced BY THE CONTRACT against the manager on every action — the manager
 *  key is never trusted (AutoConfig in GroveManager.sol). */
export interface AutoCaps {
  /** Max oracle value the manager may move in ONE action, USDG 6dp. */
  maxPerBuyUsdg: bigint;
  /** Lifetime budget across all manager actions, USDG 6dp. */
  maxTotalUsdg: bigint;
  /** Cooldown between any two manager actions, seconds (contract floor: 1h). */
  minSecondsBetween: bigint;
  /** Max fraction of any single holding sold per rebalance, bps. */
  maxRebalanceFractionBps: number;
}

/** The managed-vault consent: one signature, the WHOLE position, no meters.
 *  A grove is a curated basket users deposit into precisely so it gets
 *  managed — budgets and renewal chores are not a product, so the contract's
 *  required cap fields are signed at values that never bind ($1B budgets,
 *  full per-holding freedom, one action per six-hour window at most). The
 *  protections that actually guard the money are unchanged and cap-free:
 *  the Chainlink band on every leg, the venue whitelist, non-custody, the
 *  instant revoke, and the guardian pause. */
export const MANAGED_AUTO_CAPS: AutoCaps = {
  maxPerBuyUsdg: BigInt(1_000_000_000) * BigInt(1_000_000), // $1B: never binds
  maxTotalUsdg: BigInt(1_000_000_000) * BigInt(1_000_000),
  minSecondsBetween: BigInt(21_600), // at most once per driver window
  maxRebalanceFractionBps: 10_000, // whole holdings may rotate (delistings)
};

/** True when an on-chain AutoConfig predates the managed-vault consent (the
 *  early narrow-caps era). ANY field that still throttles Vera marks it — a
 *  narrow fraction or a weekly cooldown throttles exactly as hard as a small
 *  budget. The budget term compares against $1M (far above every cap the old
 *  UI could produce, far below MANAGED_AUTO_CAPS); fraction and cooldown
 *  compare against the managed consent itself. */
export function isLegacyAutoConfig(cfg: {
  enabled: boolean;
  maxTotalUsd: number;
  maxRebalanceFractionBps: number;
  cooldownSeconds: number;
}): boolean {
  return (
    cfg.enabled &&
    (cfg.maxTotalUsd < 1_000_000 ||
      cfg.maxRebalanceFractionBps < MANAGED_AUTO_CAPS.maxRebalanceFractionBps ||
      cfg.cooldownSeconds > Number(MANAGED_AUTO_CAPS.minSecondsBetween))
  );
}

/**
 * The sponsored batch that switches auto-manage ON for one grove:
 *
 *   1. One standing ERC-20 approval per composition token, smart account ->
 *      GroveManager. Rebalance SELL legs pull the stock from the user while
 *      the user is away — that is the whole point of auto-manage — so unlike
 *      an exit these approvals must outlive the transaction. They are only
 *      spendable through managedRebalance, which the contract gates on
 *      `enabled` + the caps below; revoking zeroes them again.
 *   2. enableAuto with the four caps.
 */
export function buildEnableAutoCalls(onChainId: number, caps: AutoCaps, compositionTokens: Address[]): Call[] {
  const MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  return [
    ...compositionTokens.map((t) => ({
      to: t,
      data: encodeFunctionData({
        abi: ERC20_MINI_ABI,
        functionName: "approve" as const,
        args: [GROVE_MANAGER as Address, MAX],
      }),
    })),
    {
      to: GROVE_MANAGER as Address,
      data: encodeFunctionData({
        abi: GROVE_MANAGER_ABI,
        functionName: "enableAuto",
        args: [BigInt(onChainId), caps.maxPerBuyUsdg, caps.maxTotalUsdg, caps.minSecondsBetween, caps.maxRebalanceFractionBps],
      }),
    },
  ];
}

/** Switch auto-manage OFF: revoke consent (instant, works even while paused)
 *  and zero every standing approval the enable batch granted. */
export function buildRevokeAutoCalls(onChainId: number, compositionTokens: Address[]): Call[] {
  return [
    {
      to: GROVE_MANAGER as Address,
      data: encodeFunctionData({
        abi: GROVE_MANAGER_ABI,
        functionName: "revokeAuto",
        args: [BigInt(onChainId)],
      }),
    },
    ...compositionTokens.map((t) => ({
      to: t,
      data: encodeFunctionData({
        abi: ERC20_MINI_ABI,
        functionName: "approve" as const,
        args: [GROVE_MANAGER as Address, BigInt(0)],
      }),
    })),
  ];
}

/**
 * The full sponsored batch for a grove buy, in order:
 *
 *   1. EIP-2612 permit, EOA -> smart account, for exactly the EOA's SHARE.
 *      Gasless and exact-value: the smart account never holds a standing
 *      allowance.
 *   2. Pull that USDG from the EOA into the smart account.
 *   3. Approve GroveManager to take the total. The contract does
 *      `transferFrom(user)`, and `user` is the smart account (msg.sender).
 *   4. buy(). The contract pulls the USDG, runs every leg against the venue,
 *      checks each against its own oracle band, and sends the stock straight
 *      back to the smart account.
 *
 * `smartUsdgRaw` = USDG already sitting at the smart account (grove-exit
 * proceeds park there). It is spent FIRST and only the shortfall crosses from
 * the EOA — without this, a user whose cash sat in the Grove account could not
 * re-enter a grove at all. When it covers the whole buy, steps 1-2 drop out.
 *
 * Everything rides one UserOp, so the basket is atomic: it fills whole or not
 * at all, and a revert anywhere leaves the user exactly as they started.
 */
export async function buildGroveBuyCalls(
  quote: GroveBuyQuoteJson,
  eoa: Address,
  smartAccount: Address,
  buildPermit: (owner: Address, spender: Address, token: Address, value: bigint) => Promise<Call>,
  smartUsdgRaw: bigint = BigInt(0),
): Promise<Call[]> {
  const total = BigInt(quote.totalInUsdg);
  if (total <= BigInt(0)) throw new Error("Nothing to buy.");
  const usdg = USDG.address as Address;
  const fromEoa = total > smartUsdgRaw ? total - smartUsdgRaw : BigInt(0);

  const calls: Call[] = [];
  if (fromEoa > BigInt(0)) {
    calls.push(await buildPermit(eoa, smartAccount, usdg, fromEoa));
    calls.push({
      to: usdg,
      data: encodeFunctionData({
        abi: ERC20_MINI_ABI,
        functionName: "transferFrom",
        args: [eoa, smartAccount, fromEoa],
      }),
    });
  }
  calls.push({
    to: usdg,
    data: encodeFunctionData({
      abi: ERC20_MINI_ABI,
      functionName: "approve",
      args: [quote.groveManager, total],
    }),
  });
  calls.push({ to: quote.groveManager, data: encodeGroveBuy(quote) });
  return calls;
}
