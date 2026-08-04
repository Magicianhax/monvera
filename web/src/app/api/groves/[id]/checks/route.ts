import type { NextRequest } from "next/server";
import { groveById } from "@/lib/groves";
import { listOutcomesForUser } from "@/lib/server/rebalanceStore";
import { toCheckRow } from "@/lib/server/groveChecks";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { jsonError, tooManyRequests, serverError } from "@/lib/server/respond";

// GET /api/groves/[id]/checks?address=0x… — every window Vera has checked THIS
// holder's basket in, newest first, each with what she decided and why.
//
// Why this exists next to /history: the chain can only show rebalances that
// HAPPENED. A basket correctly left alone produces no transaction, so a grove
// being managed perfectly looked exactly like one nobody was watching. Three
// windows ran on 2026-08-04 and the panel showed nothing, which reads as
// broken. A check that decided not to trade is the more common outcome and
// belongs on the page.
//
// Keyed by the Grove account (the smart account that owns the position), which
// is the address the ledger stores. Public like the rest of /api/groves, on the
// /api/portfolio precedent: it describes a position whose trades are already
// public on-chain.
//
// The row mapping lives in lib/server/groveChecks — a route module may only
// export HTTP methods and config, and exporting a helper here fails the
// webpack build while passing a Turbopack one.
export const dynamic = "force-dynamic";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(`groves:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const { id } = await params;
    const def = groveById(id.toLowerCase());
    if (!def) return jsonError(404, "No such grove.");
    const address = req.nextUrl.searchParams.get("address") ?? "";
    if (!ADDR.test(address)) return jsonError(400, "A valid address is required.");

    const rows = (await listOutcomesForUser(address, def.id, 40)).map(toCheckRow);
    return Response.json(
      { rows, asOf: new Date().toISOString() },
      // Short: a window closes every six hours, and a holder refreshing right
      // after one should see it.
      { headers: { "Cache-Control": "private, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    return serverError("groves-checks", err);
  }
}
