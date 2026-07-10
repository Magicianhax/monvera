import type { NextRequest } from "next/server";
import type { Hex } from "viem";
import { getRfqStatus } from "@/lib/server/arcus";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Poll a submitted RFQ fill. The router's `id` is the settlement txHash.
export const dynamic = "force-dynamic";

const TXHASH = /^0x[a-fA-F0-9]{64}$/;

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Polled every couple of seconds while a fill settles (can take minutes).
  const limit = rateLimit(`rfq-status:${user.userId}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!TXHASH.test(id)) return badRequest("Invalid transaction hash.");

  try {
    const s = await getRfqStatus(id as Hex);
    return Response.json({
      status: s.status,
      filled: s.filled,
      failed: s.failed,
      amountOut: s.amountOut ? s.amountOut.toString() : null,
      reason: s.reason,
    });
  } catch (err) {
    return serverError("rfq-status", err);
  }
}
