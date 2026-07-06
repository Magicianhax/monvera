// /api/notifications — the signed-in user's inbox.
//   GET  -> { notifications, unread }
//   POST -> mark all read
import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { unauthorized, serverError } from "@/lib/server/respond";
import { listNotifications, unreadCount, markAllRead } from "@/lib/server/notifyStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  try {
    const [notifications, unread] = await Promise.all([listNotifications(user.userId), unreadCount(user.userId)]);
    return Response.json({ notifications, unread });
  } catch (err) {
    return serverError("notifications", err);
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  try {
    await markAllRead(user.userId, Math.floor(Date.now() / 1000));
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("notifications", err);
  }
}
