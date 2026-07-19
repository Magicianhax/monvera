import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { listThreads, createThread, listMessages, appendMessage, renameThread } from "@/lib/server/veraChatStore";

// Vera chat history. Pure persistence: the intelligence stays in the existing
// invest flow (/api/allocate + client-side signing) — the client appends both
// sides of the conversation here so every session survives reloads and devices.
// Threads are bound to the VERIFIED Privy user, never a client-supplied address.
export const dynamic = "force-dynamic";

const AppendSchema = z.object({
  op: z.literal("append"),
  threadId: z.string().uuid(),
  role: z.enum(["user", "vera"]),
  kind: z.enum(["text", "plan", "success", "portfolio", "review", "sellReceipt", "quote"]).default("text"),
  content: z.string().max(4_000).default(""),
  payload: z.unknown().optional(),
});
const CreateSchema = z.object({ op: z.literal("create"), title: z.string().max(80).default("New session") });
const RenameSchema = z.object({ op: z.literal("rename"), threadId: z.string().uuid(), title: z.string().min(1).max(80) });
const BodySchema = z.discriminatedUnion("op", [AppendSchema, CreateSchema, RenameSchema]);

// Rich-card payloads (AllocateResult etc.) are bounded so the DB stays sane.
const MAX_PAYLOAD_BYTES = 32_000;

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = rateLimit(`vera-chat-read:${user.userId}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    const threadId = new URL(req.url).searchParams.get("thread");
    if (threadId) {
      const messages = await listMessages(user.userId, threadId);
      if (!messages) return badRequest("Unknown thread.");
      return Response.json({ messages });
    }
    return Response.json({ threads: await listThreads(user.userId) });
  } catch (err) {
    return serverError("vera-chat", err);
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = rateLimit(`vera-chat-write:${user.userId}`, 40, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof BodySchema.parse>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    if (body.op === "create") {
      return Response.json({ thread: await createThread(user.userId, body.title) });
    }
    if (body.op === "rename") {
      const ok = await renameThread(user.userId, body.threadId, body.title);
      return ok ? Response.json({ ok: true }) : badRequest("Unknown thread.");
    }
    if (body.payload !== undefined && JSON.stringify(body.payload).length > MAX_PAYLOAD_BYTES) {
      return badRequest("Payload too large.");
    }
    const message = await appendMessage(user.userId, body.threadId, {
      role: body.role,
      kind: body.kind,
      content: body.content,
      payload: body.payload,
    });
    return message ? Response.json({ message }) : badRequest("Unknown thread.");
  } catch (err) {
    return serverError("vera-chat", err);
  }
}
