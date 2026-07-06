import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { listRuns } from "@/lib/server/autopilotStore";
import { unauthorized, serverError } from "@/lib/server/respond";

// The caller's Autopilot run history (audit trail) — never cache.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  try {
    const runs = await listRuns(user.userId, 20);
    return Response.json({ runs });
  } catch (err) {
    return serverError("autopilot-runs", err);
  }
}
