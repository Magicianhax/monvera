// /api/watchlist — the signed-in user's starred tickers, synced across devices.
//   GET  -> { symbols }
//   POST -> { symbol, on } toggle one -> { symbols }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { listWatchlist, addWatch, removeWatch } from "@/lib/server/watchlistStore";
import { touchUser } from "@/lib/server/userDirectory";
import { ALL_ASSETS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const WatchInput = z.object({
  symbol: z.string().min(1).max(12),
  on: z.boolean(),
});

const KNOWN = new Set(ALL_ASSETS.map((a) => a.symbol));

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // Fire-and-forget directory touch: this route runs on every app open, so it
  // is where "which wallet does this user hold?" stays current — which is what
  // the hourly balance-snapshot cron reads. Authed, so nobody can inject a
  // stranger's address. Never blocks or fails the watchlist read.
  const addr = req.nextUrl.searchParams.get("address");
  if (addr && ADDR.test(addr)) void touchUser(user.userId, addr);
  try {
    return Response.json({ symbols: await listWatchlist(user.userId) });
  } catch (err) {
    return serverError("watchlist", err);
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = rateLimit(`watchlist:${user.userId}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  let body: z.infer<typeof WatchInput>;
  try {
    body = WatchInput.parse(await req.json());
  } catch {
    return badRequest("Invalid watchlist change.");
  }
  if (!KNOWN.has(body.symbol)) return badRequest("Unknown symbol.");
  try {
    if (body.on) await addWatch(user.userId, body.symbol, Date.now());
    else await removeWatch(user.userId, body.symbol);
    return Response.json({ symbols: await listWatchlist(user.userId) });
  } catch (err) {
    return serverError("watchlist", err);
  }
}
