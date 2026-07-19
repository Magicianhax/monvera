import type { NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { getQuote, getPrice, getRfqQuote, needsPermit2Allowance, venueKind, PERMIT2 } from "@/lib/server/arcus";
import { rialtoQuote, rialtoPrice } from "@/lib/server/rialto";
import { lifiPrice, lifiExecQuote } from "@/lib/server/lifiStocks";
import { uniV4Price, uniV4Quote } from "@/lib/server/uniswapV4";
import { venueEnabled } from "@/lib/server/venueFlags";
import { assetBySymbol, USDG } from "@/lib/tokens";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError, jsonError } from "@/lib/server/respond";

// Arcus spot RFQ quote for a manual buy/sell of a Robinhood stock token.
//   mode "price" -> indicative "you'll get X" (no signable payload)
//   mode "quote" -> firm quote + the Permit2 intent to sign + the settlement tx
// Uses the public Arcus router (lib/server/arcus.ts) — never cache.
export const dynamic = "force-dynamic";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

// approve(address,uint256) calldata for the AMM step lists.
function approveData(spender: string, amount: bigint): `0x${string}` {
  return `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as `0x${string}`;
}

const QuoteSchema = z.object({
  mode: z.enum(["price", "quote"]),
  side: z.enum(["buy", "sell"]),
  symbol: z.string().min(1).max(12),
  // Raw base units of the sell token. Length-capped: BigInt() parses a decimal
  // string superlinearly, so an unbounded digit string is a cheap CPU burn.
  // 30 digits covers any real amount at 18 decimals.
  sellAmount: z.string().regex(/^\d{1,30}$/),
  taker: z.string().regex(ADDR),
  // Force the RFQ venue. Some symbols' executable ("tx") settlements revert the
  // router's InvalidAction() guard when relayed from the smart account; the
  // client retries those legs router-settled instead.
  venue: z.enum(["rfq"]).optional(),
  // Cross-venue retry: skip venues that just failed to settle, so the client
  // ladder (best -> next best) can walk down without re-hitting the loser.
  avoid: z.array(z.enum(["arcus", "rialto", "lifi", "uniswap"])).max(4).optional(),
  // The user's smart account. When present, LiFi becomes an EXECUTABLE venue:
  // it quotes with fromAddress=executor (the relayed batch pulls funds there
  // first) and toAddress=taker, so output lands straight in the EOA.
  executor: z.string().regex(ADDR).optional(),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`quote:${user.userId}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof QuoteSchema.parse>;
  try {
    body = QuoteSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const asset = assetBySymbol(body.symbol);
  if (!asset) return badRequest(`Unknown symbol: ${body.symbol}`);

  const stock = asset.address;
  const usdg = USDG.address as Address;
  // Buy = USDG -> stock; sell = stock -> USDG.
  const sellToken = body.side === "buy" ? usdg : stock;
  const buyToken = body.side === "buy" ? stock : usdg;
  const sellAmount = BigInt(body.sellAmount);

  try {
    if (body.mode === "price") {
      // `kind` needs a firm quote (a venue can price a token it cannot settle), but
      // it is cached per pair for minutes, so this is one extra call now and then —
      // not per keystroke. It lets the screen warn about RFQ minimums and settlement
      // time before the user commits.
      const sellDec = body.side === "buy" ? USDG.decimals : (asset.decimals ?? 18);
      const [arcusP, arcusKind, riP, lfP, uniP] = await Promise.all([
        venueEnabled("arcus") ? getPrice(sellToken, buyToken, sellAmount).catch(() => null) : null,
        venueEnabled("arcus") ? venueKind(sellToken, buyToken).catch(() => "tx" as const) : "tx" as const,
        venueEnabled("rialto") ? rialtoPrice(sellToken, buyToken, sellAmount, sellDec, body.taker as Address) : null,
        venueEnabled("lifi") ? lifiPrice(sellToken, buyToken, sellAmount, body.taker as Address) : null,
        venueEnabled("uniswap") ? uniV4Price(sellToken, buyToken, sellAmount) : null,
      ]);
      const prices: { buy: bigint; kind: string }[] = [];
      if (arcusP?.liquidityAvailable) prices.push({ buy: arcusP.buyAmount, kind: arcusKind });
      for (const v of [riP, lfP, uniP]) if (v !== null) prices.push({ buy: v, kind: "tx" });
      if (prices.length === 0) return Response.json({ liquidityAvailable: false, buyAmount: "0", kind: "tx" });
      prices.sort((a, b) => (b.buy > a.buy ? 1 : b.buy < a.buy ? -1 : 0));
      return Response.json({ liquidityAvailable: true, buyAmount: prices[0].buy.toString(), kind: prices[0].kind });
    }

    const taker = body.taker as Address;
    const sellDec = body.side === "buy" ? USDG.decimals : (asset.decimals ?? 18);
    const avoid = new Set(body.avoid ?? []);

    // Forced Arcus-RFQ (the client's InvalidAction() retry) stays a direct path.
    if (body.venue === "rfq") {
      if (!venueEnabled("arcus")) return Response.json({ liquidityAvailable: false });
      const rfq = await getRfqQuote(sellToken, buyToken, sellAmount, taker);
      if (!rfq.liquidityAvailable || !rfq.toSign) return Response.json({ liquidityAvailable: false });
      const needsAllowance = await needsPermit2Allowance(sellToken, taker, sellAmount);
      return Response.json({
        kind: "rfq", venue: "arcus", liquidityAvailable: true,
        buyAmount: rfq.buyAmount.toString(), minBuyAmount: rfq.minBuyAmount.toString(),
        expiry: rfq.expiry, needsAllowance, permit2: PERMIT2,
        sellToken, sellAmount: sellAmount.toString(), toSign: rfq.toSign,
      });
    }

    // Best execution: quote every venue in parallel and take the biggest fill.
    // A venue erroring never blocks the comparison — it just doesn't compete.
    const executor = body.executor as Address | undefined;
    const skip = (v: "arcus" | "rialto" | "lifi" | "uniswap") => avoid.has(v) || !venueEnabled(v);
    const [txQ, rfqQ, riQ, lfQ, uniQ] = await Promise.all([
      skip("arcus") ? null : getQuote(sellToken, buyToken, sellAmount, taker).catch(() => null),
      skip("arcus") ? null : getRfqQuote(sellToken, buyToken, sellAmount, taker).catch(() => null),
      skip("rialto") ? null : rialtoQuote(sellToken, buyToken, sellAmount, sellDec, taker),
      skip("lifi") || !executor ? null : lifiExecQuote(sellToken, buyToken, sellAmount, executor, taker),
      skip("uniswap") ? null : uniV4Quote(sellToken, buyToken, sellAmount, taker).catch(() => null),
    ]);

    type Candidate = { venue: "arcus" | "rialto" | "lifi" | "uniswap"; kind: "tx" | "rfq" | "amm"; buy: bigint; json: () => Promise<Record<string, unknown>> };
    const candidates: Candidate[] = [];
    if (txQ?.liquidityAvailable && txQ.tx) {
      candidates.push({
        venue: "arcus", kind: "tx", buy: txQ.buyAmount,
        json: async () => ({
          kind: "tx", venue: "arcus", liquidityAvailable: true,
          buyAmount: txQ.buyAmount.toString(), minBuyAmount: txQ.minBuyAmount.toString(),
          needsAllowance: txQ.needsAllowance, permit2: PERMIT2,
          sellToken, sellAmount: sellAmount.toString(), toSign: txQ.toSign,
          tx: { to: txQ.tx!.to, data: txQ.tx!.data, value: txQ.tx!.value, signatureOffset: txQ.tx!.signatureOffset },
        }),
      });
    }
    if (rfqQ?.liquidityAvailable && rfqQ.toSign) {
      candidates.push({
        venue: "arcus", kind: "rfq", buy: rfqQ.buyAmount,
        json: async () => ({
          kind: "rfq", venue: "arcus", liquidityAvailable: true,
          buyAmount: rfqQ.buyAmount.toString(), minBuyAmount: rfqQ.minBuyAmount.toString(),
          expiry: rfqQ.expiry, needsAllowance: await needsPermit2Allowance(sellToken, taker, sellAmount),
          permit2: PERMIT2, sellToken, sellAmount: sellAmount.toString(), toSign: rfqQ.toSign,
        }),
      });
    }
    if (riQ) {
      candidates.push({
        venue: "rialto", kind: "tx", buy: riQ.buyAmount,
        json: async () => ({
          kind: "tx", venue: "rialto", liquidityAvailable: true,
          buyAmount: riQ.buyAmount.toString(), minBuyAmount: riQ.minBuyAmount.toString(),
          needsAllowance: riQ.needsAllowance, permit2: riQ.allowanceSpender ?? PERMIT2,
          sellToken, sellAmount: sellAmount.toString(), toSign: riQ.toSign, tx: riQ.tx,
        }),
      });
    }
    // AMM venues share one client contract: kind "amm" + `steps` the smart
    // account executes right after its permit+pull of the sell token.
    if (lfQ) {
      candidates.push({
        venue: "lifi", kind: "amm", buy: lfQ.buyAmount,
        json: async () => ({
          kind: "amm", venue: "lifi", liquidityAvailable: true,
          buyAmount: lfQ.buyAmount.toString(), minBuyAmount: lfQ.minBuyAmount.toString(),
          needsAllowance: false, sellToken, sellAmount: sellAmount.toString(),
          steps: [
            { to: sellToken, data: approveData(lfQ.approvalAddress, sellAmount), value: "0" },
            lfQ.tx,
          ],
        }),
      });
    }
    if (uniQ) {
      candidates.push({
        venue: "uniswap", kind: "amm", buy: uniQ.buyAmount,
        json: async () => ({
          kind: "amm", venue: "uniswap", liquidityAvailable: true,
          buyAmount: uniQ.buyAmount.toString(), minBuyAmount: uniQ.minBuyAmount.toString(),
          needsAllowance: false, sellToken, sellAmount: sellAmount.toString(),
          steps: uniQ.steps,
        }),
      });
    }
    if (candidates.length === 0) return Response.json({ liquidityAvailable: false });
    candidates.sort((a, b) => (b.buy > a.buy ? 1 : b.buy < a.buy ? -1 : 0));
    return Response.json(await candidates[0].json());
  } catch (err) {
    // Arcus failed outright — before surfacing anything, try the Rialto
    // fallback (firm quotes only; price mode already handled its own fallback).
    if (body.mode === "quote") {
      const sellDec = body.side === "buy" ? USDG.decimals : (asset.decimals ?? 18);
      const alt = await rialtoQuote(sellToken, buyToken, sellAmount, sellDec, body.taker as Address).catch(() => null);
      if (alt) {
        return Response.json({
          kind: "tx",
          venue: "rialto",
          liquidityAvailable: true,
          buyAmount: alt.buyAmount.toString(),
          minBuyAmount: alt.minBuyAmount.toString(),
          needsAllowance: alt.needsAllowance,
          permit2: alt.allowanceSpender ?? PERMIT2,
          sellToken,
          sellAmount: sellAmount.toString(),
          toSign: alt.toSign,
          tx: alt.tx,
        });
      }
    }
    // The router throttles per IP, shared by all our users, so a 429 here says
    // nothing about this user's trade. Surface it as a retryable "busy" rather than
    // a 500, so the screen keeps its last price instead of flashing an error.
    if (err instanceof Error && /Arcus router 429/.test(err.message)) {
      return jsonError(503, "Prices are busy right now. One moment.");
    }
    return serverError("quote", err);
  }
}
