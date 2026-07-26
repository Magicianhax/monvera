import type { NextRequest } from "next/server";
import { z } from "zod";
import { routeVera } from "@/lib/server/veraRouter";
import { isInjection, CANNED_REFUSAL } from "@/lib/server/guardrails";
import { hasAiProvider } from "@/lib/server/aiModel";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { touchUser } from "@/lib/server/userDirectory";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// POST /api/vera — one turn of Vera's chat brain: classify the user's message
// (plan / review / question / order handoff / panel handoff) and answer it.
// Calls the AI provider, so it is authed, rate limited, and geo-gated
// (middleware GATED_APIS). The client supplies its own live portfolio context
// (display data only — no money moves server-side; execution stays client-signed).
export const dynamic = "force-dynamic";

if (!hasAiProvider()) {
  console.error("[vera] no inference provider configured — chat turns will fail.");
}

const BodySchema = z.object({
  text: z.string().min(1).max(600),
  cashUsd: z.number().min(0).max(1e9).optional(),
  investedUsd: z.number().min(0).max(1e9).optional(),
  holdings: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        qty: z.number().min(0),
        valueUsd: z.number().min(0).max(1e9).optional(),
        dayChangePct: z.number().min(-100).max(1000).optional(),
        settlingUsd: z.number().min(0).max(1e9).optional(),
      }),
    )
    .max(60)
    .optional(),
  recent: z.array(z.string().max(400)).max(20).optional(),
  /** The signed-in wallet — lets Vera read this user's own on-chain history. */
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`vera:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  // Deterministic injection prefilter (post-auth, post-rate-limit): a blatant
  // role-override / jailbreak / "no JSON" attempt never reaches the model, and
  // its text is never echoed back. Real scope enforcement is still the closed
  // schema + STEP-0 prompt rule; this just short-circuits the obvious attacks.
  if (isInjection(body.text)) {
    console.warn(`[vera] injection prefilter tripped for user ${user.userId}`);
    return Response.json({ intent: "reply", message: CANNED_REFUSAL });
  }

  try {
    // Fire-and-forget: record who this user is so fleet-wide sends (the weekly
    // brief) can reach them. Never blocks or fails the turn.
    if (body.address) void touchUser(user.userId, body.address);
    const result = await routeVera({ ...body, userId: user.userId });
    return Response.json(result);
  } catch (err) {
    return serverError("vera", err);
  }
}
