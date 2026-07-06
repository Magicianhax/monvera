import type { NextRequest } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { getQuote, getPrice, PERMIT2 } from "@/lib/server/arcus";
import { assetBySymbol, USDG } from "@/lib/tokens";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

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
  sellAmount: z.string().regex(/^\d+$/), // raw base units of the sell token
  taker: z.string().regex(ADDR),
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
      const p = await getPrice(sellToken, buyToken, sellAmount);
      return Response.json({ liquidityAvailable: p.liquidityAvailable, buyAmount: p.buyAmount.toString() });
    }

    const q = await getQuote(sellToken, buyToken, sellAmount, body.taker as Address);
    if (!q.liquidityAvailable || !q.tx) {
      return Response.json({ liquidityAvailable: false });
    }
    return Response.json({
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
  } catch (err) {
    return serverError("quote", err);
  }
}
