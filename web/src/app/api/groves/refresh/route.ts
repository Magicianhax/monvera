// POST /api/groves/refresh — "a buy or exit just landed, drop the cached book."
//
// Grove buys and exits settle as sponsored UserOps from the browser, so the
// server is never in the transaction path and cannot know a position opened or
// closed. Before this, the public stats simply aged out: a 60s in-memory build
// behind `s-maxage=60, stale-while-revalidate=300`, so "Investors 2 · Total
// invested $595" stayed on screen for minutes after a holder had fully exited
// and the chain said otherwise.
//
// The alternative — polling the chain harder — costs RPC on every page view to
// catch an event that happens a few times a day. This costs one KV write, made
// by the only party that already knows: the client that just got a receipt.
//
// Authenticated, because it invalidates a shared cache; rate limited, because a
// caller that hammers it would force a rebuild (and its RPC reads) per request.
// Both are cheap protections for something that is otherwise a free DoS lever.
import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { markGrovesMutated } from "@/lib/server/groveService";
import { unauthorized, tooManyRequests, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // A settling trade is one event; 10/min is generous for retries and a burst
  // of legs, and far below anything that would make rebuilding hurt.
  const limit = rateLimit(`groves-refresh:${user.userId}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    await markGrovesMutated();
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("groves-refresh", err);
  }
}
