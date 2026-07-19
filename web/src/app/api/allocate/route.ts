import type { NextRequest } from "next/server";
import { AllocateRequestSchema } from "@/lib/allocation-schema";
import { buildAllocation } from "@/lib/server/allocate";
import { filterTradable } from "@/lib/server/tradability";
import { backtestBasket } from "@/lib/server/quant";
import { activeModelId, hasAiProvider } from "@/lib/server/aiModel";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Uses the inference API + user input — never cache.
export const dynamic = "force-dynamic";

// H-6: surface a missing provider key at module load (startup) rather than first request.
if (!hasAiProvider()) {
  console.error("[allocate] no inference provider set (VENICE_API_KEY or ANTHROPIC_API_KEY) — allocations will fail.");
}

export async function POST(req: NextRequest) {
  // C-2: only a signed-in user can spend Anthropic tokens.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // M-5: cap AI calls per user (cost-amplification guard).
  const limit = rateLimit(`allocate:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof AllocateRequestSchema.parse>;
  try {
    body = AllocateRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const allocation = await buildAllocation(body.goal, body.amountUsd, body.riskTolerance);

    // Liquidity gate: drop legs no venue can actually fill right now, BEFORE
    // the user sees the plan — the old failure mode was silent leg-skips at
    // invest time. Weights renormalize to 100 across the surviving legs.
    const { ok, dropped } = await filterTradable(allocation.allocations.map((a) => a.symbol));
    if (ok.length === 0) return badRequest("None of the assets in this plan are tradable right now — try again in a few minutes.");
    if (dropped.length > 0) {
      const okSet = new Set(ok);
      const kept = allocation.allocations.filter((a) => okSet.has(a.symbol));
      const keptSum = kept.reduce((s, a) => s + a.weightPct, 0) || 1;
      const scaled = kept.map((a) => ({ ...a, weightPct: Math.round((a.weightPct / keptSum) * 100) }));
      const drift = 100 - scaled.reduce((s, a) => s + a.weightPct, 0);
      scaled[0] = { ...scaled[0], weightPct: scaled[0].weightPct + drift };
      allocation.allocations = scaled;
      allocation.rationale = `${allocation.rationale} Skipped ${dropped.join(", ")} — no venue can fill ${dropped.length === 1 ? "it" : "them"} right now.`;
    }

    // Real-history check on the proposed mix (12 months vs SPY). Best-effort:
    // a data outage never blocks the plan itself.
    const backtest = await backtestBasket(allocation.allocations).catch(() => null);
    return Response.json({
      ...allocation,
      backtest,
      amountUsd: body.amountUsd,
      model: activeModelId(),
    });
  } catch (err) {
    return serverError("allocate", err);
  }
}
