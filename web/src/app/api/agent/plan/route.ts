import type { NextRequest } from "next/server";
import { z } from "zod";
import { buildAllocation } from "@/lib/server/allocate";
import { backtestBasket } from "@/lib/server/quant";
import { activeModelId } from "@/lib/server/aiModel";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// POST /api/agent/plan — Vera's allocation brain for OTHER AGENTS (the ACP
// seller worker calls this to fulfil paid buildPortfolioPlan jobs). Server-to-
// server only: callers must present the shared ACP_PLAN_KEY. Deliberately NOT
// in the geo-gate matcher — the caller is our own worker, not an end user, and
// the job never moves money (plan only). Uses the inference API — never cache.
export const dynamic = "force-dynamic";

const PlanRequestSchema = z.object({
  goal: z.string().min(4).max(600),
  amountUsd: z.number().positive().max(1_000_000).optional().default(1000),
  riskTolerance: z.string().max(40).optional(),
});

function keyOk(req: NextRequest): boolean {
  const expected = process.env.ACP_PLAN_KEY;
  if (!expected) return false; // unset key = endpoint disabled, never open
  const got = req.headers.get("x-agent-key") ?? "";
  if (got.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!keyOk(req)) return unauthorized();

  // Cost-amplification guard, same spirit as /api/allocate.
  const limit = rateLimit(`agent-plan:${clientIp(req)}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof PlanRequestSchema>;
  try {
    body = PlanRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body. Expected { goal, amountUsd?, riskTolerance? }.");
  }

  try {
    const allocation = await buildAllocation(body.goal, body.amountUsd, body.riskTolerance);
    // Real-history check on the proposed mix (12 months vs SPY). Best-effort:
    // a data outage never blocks the plan itself.
    const backtest = await backtestBasket(allocation.allocations).catch(() => null);
    return Response.json({
      ...allocation,
      backtest,
      amountUsd: body.amountUsd,
      model: activeModelId(),
      asOf: new Date().toISOString(),
      disclaimer:
        "A plan, not investment advice, and not an order: nothing is bought or sold by this response. Backtests are history, not promises.",
    });
  } catch (err) {
    return serverError("agent-plan", err);
  }
}
