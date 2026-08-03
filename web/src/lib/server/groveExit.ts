import "server-only";

// Build the `SwapLeg[]` for GroveManager.exit — the sell side of groveQuote.ts,
// and it obeys the same three rules: the venue is told to take from and deliver
// to the CONTRACT, Kyber only, and no routing fee inside a vault leg.
//
// What differs from a buy:
//
//  1. **The position, not the registry, decides the legs.** We sell what the
//     user actually holds (`positionOf`), which can differ from the published
//     weights after drift or a composition change. Reading the registry here
//     would try to sell tokens they may not hold.
//
//  2. **A full exit must sell EVERY tracked token to zero.** The contract
//     enforces it (`IncompleteFullExit`) so the 10% cannot be front-loaded onto
//     a sold winner while appreciated names are abandoned fee-free. So at
//     fractionBps 10000 we pass each holding's exact amount, never a computed
//     share that could round down and leave dust.
//
//  3. **Partial exits sell the same fraction of every holding**, so the basis
//     and what remains stay proportional.
import { createPublicClient, erc20Abi, http, parseAbi, type Address, type Hex } from "viem";
import { groveById } from "@/lib/groves";
import { ALL_ASSETS, MULTICALL3, USDG } from "@/lib/tokens";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "./rpc";
import { kyberQuote } from "./kyber";
import { GROVE_MANAGER, GROVE_LEG_SLIPPAGE_BPS, GroveQuoteError, MAX_LEGS } from "./groveQuote";

const client = createPublicClient({
  chain: { id: chain.id, name: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls, contracts: { multicall3: { address: MULTICALL3 } } },
  transport: http(SERVER_RPC_URL),
});

const POSITION_ABI = parseAbi([
  "function positionOf(address user, uint256 groveId) view returns (uint256 costBasisUsdg, address[] tokens, uint256[] amounts)",
]);

/** A user's live on-chain position in a grove. */
export async function readPosition(user: Address, onChainId: number): Promise<GrovePosition> {
  const [costBasisUsdg, tokens, amounts] = await client.readContract({
    address: GROVE_MANAGER as Address,
    abi: POSITION_ABI,
    functionName: "positionOf",
    args: [user, BigInt(onChainId)],
  });
  return {
    costBasisUsdg: costBasisUsdg.toString(),
    holdings: tokens.map((token, i) => ({
      symbol: symbolForToken(token),
      token,
      amount: amounts[i].toString(),
    })),
  };
}

const BPS = BigInt(10_000);
const DEADLINE_SECONDS = 600;

export interface GroveExitLeg {
  symbol: string;
  tokenIn: Address;
  tokenOut: Address;
  /** Raw token amount being sold (18dp for the stocks). */
  amountIn: string;
  /** USDG floor for this leg. Must be > 0 or _executeLeg reverts. */
  minOut: string;
  expectedOut: string;
  callTarget: Address;
  approvalTarget: Address;
  data: Hex;
  venue: "kyber";
}

export interface GroveExitQuote {
  groveId: string;
  onChainId: number;
  groveManager: Address;
  fractionBps: number;
  legs: GroveExitLeg[];
  /** Cost basis being withdrawn, USDG 6dp. Fee applies only above this. */
  basisWithdrawnUsdg: string;
  /** Sum of every leg's minOut — the guaranteed floor before fee. */
  minProceedsUsdg: string;
  /** Sum of expected outputs at quote time. */
  expectedProceedsUsdg: string;
  /** 10% of (expected proceeds - basis withdrawn), or 0 at a loss. */
  estimatedFeeUsdg: string;
  deadline: number;
}

/** A user's live position, decoded. */
export interface GrovePosition {
  costBasisUsdg: string;
  holdings: { symbol: string; token: Address; amount: string }[];
}

/**
 * Quote an exit of `fractionBps` of a user's position.
 *
 * `user` MUST be the address that holds the position — under ERC-4337 that is
 * the smart account, since the contract keys on msg.sender.
 */
export async function quoteGroveExit(
  groveId: string,
  user: Address,
  fractionBps: number,
): Promise<GroveExitQuote> {
  if (!GROVE_MANAGER) throw new GroveQuoteError("Groves are not live yet.");
  if (!Number.isInteger(fractionBps) || fractionBps < 1 || fractionBps > 10_000) {
    throw new GroveQuoteError("Choose how much of your position to sell.");
  }

  const def = groveById(groveId);
  if (!def) throw new GroveQuoteError(`No grove "${groveId}".`);
  if (def.onChainId === undefined) throw new GroveQuoteError(`${def.name} is not open yet.`);

  // Read the position ourselves. Trusting a caller-supplied one would let a
  // client understate a holding and slip past the full-exit rule.
  const position = await readPosition(user, def.onChainId);

  const basis = BigInt(position.costBasisUsdg);
  if (basis <= BigInt(0)) throw new GroveQuoteError(`You have no position in ${def.name}.`);

  const held = position.holdings.filter((h) => BigInt(h.amount) > BigInt(0));
  if (!held.length) throw new GroveQuoteError(`There is nothing left to sell in ${def.name}.`);
  if (held.length > MAX_LEGS) {
    throw new GroveQuoteError(`${held.length} holdings exceeds the contract's ${MAX_LEGS} per call.`);
  }

  const manager = GROVE_MANAGER as Address;
  const full = fractionBps === 10_000;

  // The position is only half the truth: exit legs safeTransferFrom the WALLET,
  // and nothing stops a user selling grove-bought tokens through the ordinary
  // flows first. Quoting from tracked amounts alone produced calldata that could
  // only revert on-chain — an opaque dead end. Check the real balances here and
  // fail with the largest fraction the wallet can still cover, so the UI can
  // offer that or the zero-fee closePosition hatch.
  const wallet = await client.multicall({
    contracts: held.map((h) => ({
      address: h.token,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [user] as const,
    })),
  });
  const short: string[] = [];
  let maxFractionBps = 10_000;
  for (let i = 0; i < held.length; i++) {
    const bal = wallet[i].status === "success" ? (wallet[i].result as bigint) : BigInt(0);
    const tracked = BigInt(held[i].amount);
    if (bal >= tracked) continue;
    short.push(held[i].symbol);
    const f = Number((bal * BPS) / tracked); // floor — never offer more than covered
    if (f < maxFractionBps) maxFractionBps = f;
  }
  if (short.length && (full || fractionBps > maxFractionBps)) {
    const list = short.join(", ");
    throw new GroveQuoteError(
      maxFractionBps > 0
        ? `Part of this basket (${list}) has left your wallet since it was bought — you can exit up to ${Math.floor(maxFractionBps / 100)}% here. For the rest, clear the position: it zeroes the Grove's accounting with no swap and no fee.`
        : `This basket (${list}) is no longer in your wallet, so there is nothing the Grove can sell. Clear the position instead — it zeroes the accounting with no swap and no fee.`,
      { code: "SHORT_BALANCE", maxFractionBps },
    );
  }

  const sized = held.map((h) => ({
    ...h,
    // Exact amount on a full exit: the contract requires every tracked token to
    // reach zero, and a rounded-down share would leave dust and revert.
    amountIn: full ? BigInt(h.amount) : (BigInt(h.amount) * BigInt(fractionBps)) / BPS,
  }));

  const dust = sized.filter((s) => s.amountIn <= BigInt(0));
  if (dust.length) {
    throw new GroveQuoteError(
      `${dust.map((d) => d.symbol).join(", ")} would round to zero at that size. Sell a larger share.`,
    );
  }

  const quoted = await Promise.all(
    sized.map(async (s) => {
      try {
        // sender AND recipient are the CONTRACT — it measures its own delta.
        // Same widened bound as the buy legs: one tripped leg reverts them all.
        const q = await kyberQuote(s.token, USDG.address as Address, s.amountIn, manager, manager, "none", GROVE_LEG_SLIPPAGE_BPS);
        return q ? { s, quote: q } : { s, error: "no route right now" as const };
      } catch {
        return { s, error: "the venue did not respond" as const };
      }
    }),
  );

  const bad = quoted.filter((r) => !("quote" in r && r.quote));
  if (bad.length) {
    const names = bad.map((r) => `${r.s.symbol} (${"error" in r ? r.error : "unavailable"})`);
    throw new GroveQuoteError(
      `Could not price ${names.join(", ")}. An exit is all-or-nothing, so nothing was sold. Try again shortly.`,
    );
  }

  const legs: GroveExitLeg[] = quoted.map(({ s, quote }) => {
    const q = quote!;
    if (q.steps.length !== 2 || q.steps[0].to.toLowerCase() !== s.token.toLowerCase()) {
      throw new GroveQuoteError(`${s.symbol} returned an unexpected route shape. Nothing was sold.`);
    }
    if (q.minBuyAmount <= BigInt(0)) {
      throw new GroveQuoteError(`${s.symbol} quoted a zero minimum. Nothing was sold.`);
    }
    return {
      symbol: s.symbol,
      tokenIn: s.token,
      tokenOut: USDG.address as Address,
      amountIn: s.amountIn.toString(),
      minOut: q.minBuyAmount.toString(),
      expectedOut: q.buyAmount.toString(),
      callTarget: q.steps[1].to,
      approvalTarget: q.steps[1].to,
      venue: "kyber",
      data: q.steps[1].data,
    };
  });

  const basisWithdrawn = (basis * BigInt(fractionBps)) / BPS;
  const minProceeds = legs.reduce((a, l) => a + BigInt(l.minOut), BigInt(0));
  const expected = legs.reduce((a, l) => a + BigInt(l.expectedOut), BigInt(0));
  // Mirrors the contract: fee only on the profit above the basis withdrawn.
  const fee = expected > basisWithdrawn ? ((expected - basisWithdrawn) * BigInt(def.feeBps)) / BPS : BigInt(0);

  return {
    groveId: def.id,
    onChainId: def.onChainId,
    groveManager: manager,
    fractionBps,
    legs,
    basisWithdrawnUsdg: basisWithdrawn.toString(),
    minProceedsUsdg: minProceeds.toString(),
    expectedProceedsUsdg: expected.toString(),
    estimatedFeeUsdg: fee.toString(),
    deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
  };
}

/** Best-effort symbol for a position token. A position can outlive a
 *  composition change, so an unknown token gets a truncated address rather than
 *  being hidden — the user still needs to see that they hold it. */
export function symbolForToken(token: Address): string {
  const hit = ALL_ASSETS.find((a) => a.address.toLowerCase() === token.toLowerCase());
  return hit?.symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`;
}
