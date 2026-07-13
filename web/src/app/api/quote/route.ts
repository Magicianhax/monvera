import type { NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { getQuote, getPrice, getRfqQuote, needsPermit2Allowance, venueKind, PERMIT2 } from "@/lib/server/arcus";
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
      const [p, kind] = await Promise.all([
        getPrice(sellToken, buyToken, sellAmount),
        venueKind(sellToken, buyToken),
      ]);
      return Response.json({
        liquidityAvailable: p.liquidityAvailable,
        buyAmount: p.buyAmount.toString(),
        kind,
      });
    }

    const taker = body.taker as Address;
    const q = body.venue === "rfq"
      ? { liquidityAvailable: false as const, tx: null }
      : await getQuote(sellToken, buyToken, sellAmount, taker);
    if (q.liquidityAvailable && q.tx) {
      return Response.json({
        kind: "tx",
        liquidityAvailable: true,
        buyAmount: q.buyAmount.toString(),
        minBuyAmount: q.minBuyAmount.toString(),
        needsAllowance: q.needsAllowance,
        permit2: PERMIT2,
        sellToken,
        sellAmount: sellAmount.toString(),
        toSign: q.toSign,
        tx: { to: q.tx.to, data: q.tx.data, value: q.tx.value, signatureOffset: q.tx.signatureOffset },
      });
    }

    // Most assets quote only on the RFQ venue, which returns no client tx: the
    // taker signs the intent and the router settles it. Same EOA signature, but
    // we POST it rather than batching it into our userOp.
    const rfq = await getRfqQuote(sellToken, buyToken, sellAmount, taker);
    if (!rfq.liquidityAvailable || !rfq.toSign) {
      return Response.json({ liquidityAvailable: false });
    }
    const needsAllowance = await needsPermit2Allowance(sellToken, taker, sellAmount);
    return Response.json({
      kind: "rfq",
      liquidityAvailable: true,
      buyAmount: rfq.buyAmount.toString(),
      minBuyAmount: rfq.minBuyAmount.toString(),
      expiry: rfq.expiry,
      needsAllowance,
      permit2: PERMIT2,
      sellToken,
      sellAmount: sellAmount.toString(),
      toSign: rfq.toSign,
    });
  } catch (err) {
    // The router throttles per IP, shared by all our users, so a 429 here says
    // nothing about this user's trade. Surface it as a retryable "busy" rather than
    // a 500, so the screen keeps its last price instead of flashing an error.
    if (err instanceof Error && /Arcus router 429/.test(err.message)) {
      return jsonError(503, "Prices are busy right now. One moment.");
    }
    return serverError("quote", err);
  }
}
