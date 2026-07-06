import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";
import { AllocationSchema } from "@/lib/allocation-schema";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Signs Vera's risk inference for a plan so the client can append the on-chain
// VeraRecord.record(...) call to the invest batch. Signs with the agent key +
// reads the clock — never cache.
export const dynamic = "force-dynamic";

// Hard upper bound so a caller can't get the agent to sign an absurd plan.
const MAX_AMOUNT_USD = 1_000_000;

const AGENT_ID = process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1";
const RISK_HEADROOM_BPS = 1500; // how far above assessed risk the ceiling sits
const RISK_CEILING_BPS = 10000;
const EXPIRY_SECONDS = 15 * 60;

const CommitPlanRequestSchema = z.object({
  address: z.string().refine((a) => isAddress(a), "Invalid wallet address."),
  allocation: AllocationSchema,
  amountUsd: z.number().positive().max(MAX_AMOUNT_USD),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`commit-plan:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof CommitPlanRequestSchema>;
  try {
    body = CommitPlanRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const { allocation } = body;
    const nowSeconds = Math.floor(Date.now() / 1000);

    const planId = buildPlanId(allocation, nowSeconds);
    const assessedRisk = Math.max(0, Math.min(RISK_CEILING_BPS, Math.round(allocation.riskScore)));
    const maxRisk = Math.min(RISK_CEILING_BPS, assessedRisk + RISK_HEADROOM_BPS);
    const expiry = BigInt(nowSeconds + EXPIRY_SECONDS);
    const signature = await signRiskInference({ planId, assessedRisk, maxRisk, expiry });

    return Response.json({
      planId,
      recHash: recHash(allocation),
      assessedRisk,
      maxRisk,
      expiry: expiry.toString(),
      signature,
      agentId: AGENT_ID,
    });
  } catch (err) {
    return serverError("commit-plan", err);
  }
}
