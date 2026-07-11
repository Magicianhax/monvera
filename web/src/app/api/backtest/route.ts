import type { NextRequest } from "next/server";
import { z } from "zod";
import { backtestBasket } from "@/lib/server/quant";
import { isTradable } from "@/lib/tokens";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// POST /api/backtest — 12-month real-history simulation of a weighted basket
// (lib/server/quant). Public market data only, no inference, no user funds —
// so no auth, just an IP rate limit. Upstream history is cached 6h per symbol.
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  allocations: z
    .array(
      z.object({
        symbol: z.string().refine(isTradable, "Unknown symbol."),
        weightPct: z.number().positive().max(100),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(req: NextRequest) {
  const limit = rateLimit(`backtest:${clientIp(req)}`, 60, 60_000 /* per-IP: generous — VPN exits and CGNAT put many users behind one IP */);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const result = await backtestBasket(body.allocations);
    return Response.json({ backtest: result });
  } catch (err) {
    return serverError("backtest", err);
  }
}
