// /api/alerts — the signed-in user's price alerts.
//   GET    -> { alerts }
//   POST   -> create { symbol, direction, threshold }
//   DELETE -> ?id=N remove
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { createAlert, listAlerts, deleteAlert } from "@/lib/server/notifyStore";
import { ALL_ASSETS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const AlertInput = z.object({
  symbol: z.string().min(1).max(12),
  direction: z.enum(["above", "below"]),
  threshold: z.number().positive().max(10_000_000),
});

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  try {
    return Response.json({ alerts: await listAlerts(user.userId) });
  } catch (err) {
    return serverError("alerts", err);
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = rateLimit(`alerts:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  let body: z.infer<typeof AlertInput>;
  try {
    body = AlertInput.parse(await req.json());
  } catch {
    return badRequest("Invalid alert.");
  }
  if (!ALL_ASSETS.some((a) => a.symbol === body.symbol)) return badRequest("Unknown symbol.");
  try {
    const existing = await listAlerts(user.userId);
    if (existing.filter((a) => a.active).length >= 20) return badRequest("Alert limit reached (20).");
    await createAlert(user.userId, { ...body, at: Math.floor(Date.now() / 1000) });
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("alerts", err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id.");
  try {
    await deleteAlert(user.userId, id);
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("alerts", err);
  }
}
