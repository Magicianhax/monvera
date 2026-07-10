import type { NextRequest } from "next/server";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { submitRfq } from "@/lib/server/arcus";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Hand a taker-signed Arcus RFQ intent to the router, which submits settlement
// on-chain. Used for the ~70 assets that have no client-submittable venue.
// The signature authorizes exactly one trade and carries its own on-chain
// minBuyAmount floor, so relaying it cannot move funds on any other terms.
export const dynamic = "force-dynamic";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const SIG = /^0x[a-fA-F0-9]{130}$/; // 65-byte EOA signature

// The router settles whatever intent we relay. Cap the payload so an authed
// caller can't use us to shovel megabytes at it.
const MAX_TYPED_DATA_BYTES = 10_000;

const SubmitSchema = z.object({
  taker: z.string().regex(ADDR),
  signature: z.string().regex(SIG),
  // The quote's `toSign`, echoed back verbatim. Shape-checked, not re-derived:
  // the taker already signed these exact bytes in their own browser.
  typedData: z.object({
    domain: z.record(z.string(), z.unknown()),
    types: z.record(z.string(), z.unknown()),
    primaryType: z.literal("PermitWitnessTransferFrom"),
    message: z.record(z.string(), z.unknown()),
  }),
});

/** The taker the signature actually authorizes, read out of the signed witness. */
function signedTaker(typedData: { message: Record<string, unknown> }): string | null {
  const witness = typedData.message.witness;
  if (!witness || typeof witness !== "object") return null;
  const taker = (witness as { taker?: unknown }).taker;
  return typeof taker === "string" ? taker : null;
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`rfq-submit:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof SubmitSchema.parse>;
  try {
    body = SubmitSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  if (JSON.stringify(body.typedData).length > MAX_TYPED_DATA_BYTES) {
    return badRequest("Invalid request body.");
  }

  // The `taker` we relay must be the one bound inside the signed witness. The
  // witness is what Permit2 verifies on-chain, so a signature lifted from
  // somewhere else cannot be replayed here under a different taker.
  const bound = signedTaker(body.typedData);
  if (!bound || bound.toLowerCase() !== body.taker.toLowerCase()) {
    return badRequest("That signature doesn't match this account.");
  }

  try {
    const r = await submitRfq(body.taker as Address, body.typedData, body.signature as Hex);
    return Response.json({ txHash: r.txHash, status: r.status, settledToken: r.settledToken, orderId: r.orderId });
  } catch (err) {
    // Sub-minimum orders quote cleanly and are rejected here, by the maker. Say so
    // plainly: nothing moved, and a larger amount usually fills.
    const msg = err instanceof Error ? err.message : "";
    if (/minimum|too small|below/i.test(msg)) {
      return badRequest("The market maker turned down this order for being too small. Nothing was charged. Try a larger amount.");
    }
    return serverError("rfq-submit", err);
  }
}
