import type { NextRequest } from "next/server";
import { z } from "zod";
import { quoteGroveBuy, GroveQuoteError } from "@/lib/server/groveQuote";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Firm, contract-shaped quote for a grove buy: the exact `SwapLeg[]` that goes
// into GroveManager.buy, already sized, priced and bounded.
//
// Separate from /api/quote on purpose — a grove leg is quoted FOR THE CONTRACT
// (it is the swap's sender and recipient), with no routing fee, and restricted
// to venues whose approve+call shape the leg struct can express. See
// lib/server/groveQuote.ts for why each of those is load-bearing.
//
// Never cached: the calldata carries a deadline and a slippage bound.
export const dynamic = "force-dynamic";

const BuySchema = z.object({
  groveId: z.string().min(1).max(32),
  // Dollars, not base units — the server owns the split across components so
  // the per-leg floor and the contract's MIN_BUY_USDG can never disagree.
  amountUsd: z.number().positive().max(1_000_000),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Each call fans out to the venue once per component, so it is heavier than a
  // single-symbol quote. Bounded tighter than /api/quote's 30.
  const limit = rateLimit(`grove-quote:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof BuySchema.parse>;
  try {
    body = BuySchema.parse(await req.json());
  } catch {
    return badRequest("Bad request.");
  }

  try {
    return Response.json(await quoteGroveBuy(body.groveId, body.amountUsd));
  } catch (err) {
    // GroveQuoteError messages are written to be shown to the user; anything
    // else is ours, and serverError logs it without leaking it.
    if (err instanceof GroveQuoteError) return badRequest(err.message);
    return serverError("grove-quote", err);
  }
}
