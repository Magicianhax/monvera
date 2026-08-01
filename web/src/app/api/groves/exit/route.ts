import type { NextRequest } from "next/server";
import { z } from "zod";
import { quoteGroveExit } from "@/lib/server/groveExit";
import { GroveQuoteError } from "@/lib/server/groveQuote";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Firm, contract-shaped quote for a grove exit: the `SwapLeg[]` for
// GroveManager.exit, plus what the user will actually net.
//
// `user` is the address holding the position — under ERC-4337 that is the
// caller's SMART ACCOUNT, not their EOA. It is not a permission: positions are
// public, and the exit itself is authorized on-chain by msg.sender, so quoting
// someone else's position reveals nothing private and executes nothing.
//
// Never cached: the calldata carries a deadline and a slippage bound.
export const dynamic = "force-dynamic";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

const ExitSchema = z.object({
  groveId: z.string().min(1).max(32),
  user: z.string().regex(ADDR),
  /** 1..10000. 10000 sells every tracked token to zero — the contract requires
   *  a full-basis withdrawal to be a full liquidation. */
  fractionBps: z.number().int().min(1).max(10_000),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`grove-exit:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof ExitSchema.parse>;
  try {
    body = ExitSchema.parse(await req.json());
  } catch {
    return badRequest("Bad request.");
  }

  try {
    return Response.json(
      await quoteGroveExit(body.groveId, body.user as `0x${string}`, body.fractionBps),
    );
  } catch (err) {
    if (err instanceof GroveQuoteError) return badRequest(err.message);
    return serverError("grove-exit", err);
  }
}
