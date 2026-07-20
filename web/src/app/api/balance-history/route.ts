// GET /api/balance-history?address=0x… — the hourly equity curve from D1
// snapshots (oldest -> newest). Public like /api/portfolio: it reveals only
// what the chain already shows for an address, and the balance chart needs it
// before login state settles.
import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { listSnapshots } from "@/lib/server/balanceSnapshots";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { badRequest, tooManyRequests } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`balance-history:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return badRequest("Invalid address.");
  const hours = Math.min(24 * 90, Math.max(2, Number(req.nextUrl.searchParams.get("hours")) || 24 * 30));

  const snapshots = await listSnapshots(address, hours).catch(() => []);
  return Response.json(
    { snapshots, asOf: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
