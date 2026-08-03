import "server-only";

// Build the `SwapLeg[]` that GroveManager.buy takes, from live venue quotes.
//
// This is deliberately NOT /api/quote. A grove leg is a different shape and
// obeys different rules, and both are load-bearing:
//
//  1. **The swap runs inside GroveManager, not the smart account.** The contract
//     pulls USDG to itself, approves the venue, calls it, and measures its OWN
//     balance delta. So the venue must be told to take from and deliver to the
//     CONTRACT. Quoting with the user's address would make the contract's
//     measured output zero and revert (`_executeLeg` names that exact case).
//
//  2. **Kyber only, for now.** `SwapLeg` carries one `approvalTarget`, one
//     `callTarget` and one calldata, and `_executeLeg` performs exactly one
//     ERC-20 approve before the call. Kyber fits: its router is its own spender.
//     Uniswap V4 does NOT — it needs `token.approve(Permit2)` AND
//     `Permit2.approve(token, router, ...)` before `execute`, and nothing in the
//     leg shape can express that second approval, so a Uniswap leg reverts when
//     the router tries to pull. LiFi's shape would fit (single approve, then
//     call) but its approvalAddress varies per quote, so it is not whitelisted
//     on-chain yet. Adding it is a 48h proposal, not a code change here.
//
//  3. **No routing fee inside a vault leg** — `feeMode: "none"`. The grove's own
//     10%-of-profit-at-exit is the fee; charging our swap bps on top would be
//     double-dipping on money the user has not made yet.
//
// A grove buy is ATOMIC: one call, all legs, all-or-nothing. That is the point
// (you get the basket or you get nothing), but it means the usual per-leg
// "quote, settle, skip on failure" ladder does not apply — every leg is quoted
// as late as possible and they all ride the same deadline.
import { type Address, type Hex } from "viem";
import { groveById, groveLegsFor, type GroveDef } from "@/lib/groves";
import { assetBySymbol, USDG } from "@/lib/tokens";
import { splitByWeights } from "@/lib/arcusShared";
import { kyberQuote } from "./kyber";

/** GroveManager. Unset means groves are not deployed — callers show preview. */
export const GROVE_MANAGER = (process.env.NEXT_PUBLIC_GROVE_MANAGER ||
  process.env.GROVE_MANAGER_ADDRESS ||
  "") as Address | "";

/** Mirrors GroveManager.MIN_BUY_USDG — the contract reverts BuyLegTooSmall. */
export const MIN_BUY_USDG = BigInt(11_000_000);
/** Mirrors GroveManager.MAX_LEGS. */
export const MAX_LEGS = 20;
/** How long the built calldata stays valid. Every leg shares one deadline. */
const DEADLINE_SECONDS = 600;

/** Router slippage bound for grove legs, wider than the 50bps ordinary trades
 *  use. These stock pools reprice on oracle pushes, so a quote can move >0.5%
 *  in the seconds before settlement — at 50bps a live buy reverted with
 *  Kyber's "Return amount is not enough" during simulation (2026-08-03), and
 *  in an atomic basket ONE tripped leg reverts every leg. The user's real
 *  price floor is unchanged: GroveManager checks each leg against its own
 *  Chainlink band (300bps fresh) on-chain. */
export const GROVE_LEG_SLIPPAGE_BPS = 150;

export interface GroveLegQuote {
  symbol: string;
  tokenIn: Address;
  tokenOut: Address;
  /** USDG, 6dp, as a decimal string (bigint is not JSON-serializable). */
  amountIn: string;
  /** Venue slippage floor. MUST be > 0 or _executeLeg reverts MinOutRequired. */
  minOut: string;
  /** Expected output at quote time, for display only. */
  expectedOut: string;
  callTarget: Address;
  approvalTarget: Address;
  data: Hex;
  venue: "kyber";
}

export interface GroveBuyQuote {
  groveId: string;
  onChainId: number;
  groveManager: Address;
  legs: GroveLegQuote[];
  /** Sum of every leg's amountIn — what the contract will pull. */
  totalInUsdg: string;
  deadline: number;
  /** Names the sizing dropped, with the honest reason. Never silent. */
  skipped: { symbol: string; reason: string }[];
}

export class GroveQuoteError extends Error {
  /** Machine-readable reason, when the client can offer a recovery path.
   *  "SHORT_BALANCE": the wallet no longer holds enough of a tracked token to
   *  cover the requested exit (sold or moved outside the Grove). */
  code?: "SHORT_BALANCE";
  /** With SHORT_BALANCE: the largest fractionBps the wallet can still cover
   *  (0 = nothing is exitable through the contract; closePosition is the hatch). */
  maxFractionBps?: number;

  constructor(message: string, extra?: { code: "SHORT_BALANCE"; maxFractionBps: number }) {
    super(message);
    if (extra) {
      this.code = extra.code;
      this.maxFractionBps = extra.maxFractionBps;
    }
  }
}

/**
 * Quote a buy of `amountUsd` into a grove, ready to hand to GroveManager.buy.
 * Throws GroveQuoteError with a user-safe message when it cannot be built.
 */
export async function quoteGroveBuy(groveId: string, amountUsd: number): Promise<GroveBuyQuote> {
  if (!GROVE_MANAGER) throw new GroveQuoteError("Groves are not live yet.");
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new GroveQuoteError("Enter an amount to invest.");

  const def = groveById(groveId);
  if (!def) throw new GroveQuoteError(`No grove "${groveId}".`);
  if (def.onChainId === undefined) throw new GroveQuoteError(`${def.name} is not open yet.`);
  if (amountUsd < def.minBuyUsd) {
    throw new GroveQuoteError(`The smallest buy into ${def.name} is $${def.minBuyUsd}.`);
  }

  const { legs: sized, skipped } = sizeLegs(def, amountUsd);
  if (!sized.length) throw new GroveQuoteError(`$${amountUsd} is too small to place a single leg.`);
  if (sized.length > MAX_LEGS) throw new GroveQuoteError(`${sized.length} legs exceeds the contract's ${MAX_LEGS}.`);

  const manager = GROVE_MANAGER as Address;
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;

  // Quote every leg in parallel and as late as possible — they all ride one
  // deadline, so the spread between first and last quote is pure staleness risk.
  const quoted = await Promise.all(
    sized.map(async (leg) => {
      const asset = assetBySymbol(leg.symbol);
      if (!asset) return { leg, error: "not in the token registry" as const };
      try {
        // sender AND recipient are the CONTRACT — see note 1 at the top.
        const q = await kyberQuote(
          USDG.address as Address,
          asset.address as Address,
          leg.amountMicro,
          manager,
          manager,
          "none",
          GROVE_LEG_SLIPPAGE_BPS,
        );
        if (!q) return { leg, error: "no route right now" as const };
        return { leg, quote: q };
      } catch {
        return { leg, error: "the venue did not respond" as const };
      }
    }),
  );

  // Atomic buy: a leg we cannot quote means we cannot build the basket at all.
  // Failing here is far better than letting the contract revert the whole call
  // after the user has already approved it.
  const unquotable = quoted.filter((r) => !("quote" in r && r.quote));
  if (unquotable.length) {
    const names = unquotable.map((r) => `${r.leg.symbol} (${"error" in r ? r.error : "unavailable"})`);
    throw new GroveQuoteError(
      `Could not price ${names.join(", ")}. A grove buy is all-or-nothing, so nothing was sent. Try again shortly.`,
    );
  }

  const legs: GroveLegQuote[] = quoted.map(({ leg, quote }) => {
    const q = quote!;
    const asset = assetBySymbol(leg.symbol)!;

    // Kyber's router is both spender and call target; kyber.ts already refuses
    // any router off its pin, so a mismatch here means the shape changed under
    // us. Validate before reading a position out of it.
    if (q.steps.length !== 2 || q.steps[0].to.toLowerCase() !== USDG.address.toLowerCase()) {
      throw new GroveQuoteError(`${leg.symbol} returned an unexpected route shape. Nothing was sent.`);
    }
    // The contract reverts MinOutRequired on a zero floor, and a zero here would
    // also mean the venue promised nothing. Refuse before it costs gas.
    if (q.minBuyAmount <= BigInt(0)) {
      throw new GroveQuoteError(`${leg.symbol} quoted a zero minimum. Nothing was sent.`);
    }
    const router = q.steps[1].to;

    return {
      symbol: leg.symbol,
      tokenIn: USDG.address as Address,
      tokenOut: asset.address as Address,
      amountIn: leg.amountMicro.toString(),
      minOut: q.minBuyAmount.toString(),
      expectedOut: q.buyAmount.toString(),
      callTarget: router,
      approvalTarget: router,
      data: q.steps[1].data,
      venue: "kyber",
    };
  });

  return {
    groveId: def.id,
    onChainId: def.onChainId,
    groveManager: manager,
    legs,
    totalInUsdg: legs.reduce((s, l) => s + BigInt(l.amountIn), BigInt(0)).toString(),
    deadline,
    skipped,
  };
}

interface SizedLeg {
  symbol: string;
  amountMicro: bigint;
}

/**
 * Split `amountUsd` across the grove's components at their published weights.
 * Small buys concentrate (groveLegsFor drops the tail), then any leg still under
 * the contract's MIN_BUY_USDG is dropped and its weight redistributed — the
 * contract would revert BuyLegTooSmall otherwise.
 */
function sizeLegs(def: GroveDef, amountUsd: number): { legs: SizedLeg[]; skipped: { symbol: string; reason: string }[] } {
  const skipped: { symbol: string; reason: string }[] = [];
  const grossMicro = BigInt(Math.floor(amountUsd * 1e6));

  let candidates = groveLegsFor(def, amountUsd).map((l) => ({ symbol: l.symbol, weightPct: l.weightPct }));
  for (const c of def.components) {
    if (!candidates.some((x) => x.symbol === c.symbol)) {
      skipped.push({ symbol: c.symbol, reason: "too small a slice at this amount" });
    }
  }

  // Re-split and re-check until every surviving leg clears the contract floor.
  // Dropping one leg grows the others, so this can only converge downward.
  for (;;) {
    if (!candidates.length) return { legs: [], skipped };
    const amounts = splitByWeights(
      grossMicro,
      candidates.map((c) => c.weightPct),
    );
    const under = amounts.findIndex((a) => a < MIN_BUY_USDG);
    if (under === -1) {
      return { legs: candidates.map((c, i) => ({ symbol: c.symbol, amountMicro: amounts[i] })), skipped };
    }
    skipped.push({ symbol: candidates[under].symbol, reason: `slice under the $11 per-leg floor` });
    candidates = candidates.filter((_, i) => i !== under);
  }
}
