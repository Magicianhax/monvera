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
 * The full sponsored batch for a grove buy, in order:
 *
 *   1. EIP-2612 permit, EOA -> smart account, for exactly the total. Gasless and
 *      exact-value: the smart account never holds a standing allowance.
 *   2. Pull that USDG from the EOA into the smart account.
 *   3. Approve GroveManager to take it. The contract does `transferFrom(user)`,
 *      and `user` is the smart account because it is `msg.sender`.
 *   4. buy(). The contract pulls the USDG, runs every leg against the venue,
 *      checks each against its own oracle band, and sends the stock straight
 *      back to the smart account.
 *
 * All four ride one UserOp, so the basket is atomic: it fills whole or not at
 * all, and a revert anywhere leaves the user exactly as they started.
 */
export async function buildGroveBuyCalls(
  quote: GroveBuyQuoteJson,
  eoa: Address,
  smartAccount: Address,
  buildPermit: (owner: Address, spender: Address, token: Address, value: bigint) => Promise<Call>,
): Promise<Call[]> {
  const total = BigInt(quote.totalInUsdg);
  if (total <= BigInt(0)) throw new Error("Nothing to buy.");
  const usdg = USDG.address as Address;

  return [
    await buildPermit(eoa, smartAccount, usdg, total),
    {
      to: usdg,
      data: encodeFunctionData({
        abi: ERC20_MINI_ABI,
        functionName: "transferFrom",
        args: [eoa, smartAccount, total],
      }),
    },
    {
      to: usdg,
      data: encodeFunctionData({
        abi: ERC20_MINI_ABI,
        functionName: "approve",
        args: [quote.groveManager, total],
      }),
    },
    { to: quote.groveManager, data: encodeGroveBuy(quote) },
  ];
}
