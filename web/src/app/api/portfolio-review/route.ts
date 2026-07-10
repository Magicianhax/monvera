import type { NextRequest } from "next/server";
import { z } from "zod";
import { reviewPortfolio } from "@/lib/server/portfolioReview";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// POST /api/portfolio-review — Vera assesses the caller's real holdings:
// concentration, theme overlap, the mix's own 12-month history vs SPY, and up
// to three proposal-only nudges. Calls the AI provider, so it is authed, rate
// limited, and behind the geo-gate (middleware matcher).
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  holdings: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        weightPct: z.number().positive().max(100),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Each review is an inference call; same cost guard as /api/allocate.
  const limit = rateLimit(`portfolio-review:${user.userId}`, 6, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof BodySchema.parse>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const review = await reviewPortfolio(body.holdings);
    return Response.json(review);
  } catch (err) {
    if (err instanceof Error && /Nothing to review/.test(err.message)) {
      return badRequest(err.message);
    }
    return serverError("portfolio-review", err);
  }
}
