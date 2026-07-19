import "server-only";

// Vera chat history — D1 store (schema: migrations/0008_vera_chat.sql).
// Threads are owned by the verified Privy userId; every accessor takes the
// owner and scopes queries to it, so cross-user reads are impossible by
// construction. Messages are append-only; rich cards (plans, invest receipts)
// carry their structured data in `payload` so the UI re-renders them exactly.
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface D1Result<T> { results: T[] }
interface D1Stmt { bind(...v: unknown[]): D1Stmt; run<T = unknown>(): Promise<D1Result<T>>; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<D1Result<T>> }
interface D1Db { prepare(sql: string): D1Stmt }
function db(): D1Db {
  const env = getCloudflareContext().env as { DB?: D1Db };
  if (!env.DB) throw new Error("D1 binding DB is not configured.");
  return env.DB;
}

export type MessageRole = "user" | "vera";
export type MessageKind = "text" | "plan" | "success" | "portfolio" | "review" | "sellReceipt" | "quote";

export interface ChatThread { id: string; title: string; createdAt: number; updatedAt: number }
export interface ChatMessage { id: string; threadId: string; role: MessageRole; kind: MessageKind; content: string; payload: unknown | null; createdAt: number }

const now = () => Math.floor(Date.now() / 1000);

/** Newest-first list of the owner's threads. */
export async function listThreads(owner: string, limit = 40): Promise<ChatThread[]> {
  const rows = (
    await db()
      .prepare("SELECT id,title,created_at,updated_at FROM vera_threads WHERE owner=? ORDER BY updated_at DESC LIMIT ?")
      .bind(owner, limit)
      .all<{ id: string; title: string; created_at: number; updated_at: number }>()
  ).results;
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export async function createThread(owner: string, title: string): Promise<ChatThread> {
  const id = crypto.randomUUID();
  const t = now();
  await db().prepare("INSERT INTO vera_threads (id,owner,title,created_at,updated_at) VALUES (?,?,?,?,?)").bind(id, owner, title || "New session", t, t).run();
  return { id, title: title || "New session", createdAt: t, updatedAt: t };
}

/** The thread, only if the caller owns it. */
async function ownedThread(owner: string, threadId: string): Promise<boolean> {
  const row = await db().prepare("SELECT 1 AS x FROM vera_threads WHERE id=? AND owner=?").bind(threadId, owner).first();
  return !!row;
}

/** Oldest-first messages of an owned thread; null if not the owner's thread. */
export async function listMessages(owner: string, threadId: string): Promise<ChatMessage[] | null> {
  if (!(await ownedThread(owner, threadId))) return null;
  const rows = (
    await db()
      .prepare("SELECT id,thread_id,role,kind,content,payload,created_at FROM vera_messages WHERE thread_id=? ORDER BY created_at ASC, id ASC")
      .bind(threadId)
      .all<{ id: string; thread_id: string; role: string; kind: string; content: string; payload: string | null; created_at: number }>()
  ).results;
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role as MessageRole,
    kind: r.kind as MessageKind,
    content: r.content,
    payload: r.payload ? (JSON.parse(r.payload) as unknown) : null,
    createdAt: r.created_at,
  }));
}

/** Append a message to an owned thread (bumps the thread's updated_at). */
export async function appendMessage(
  owner: string,
  threadId: string,
  msg: { role: MessageRole; kind: MessageKind; content: string; payload?: unknown },
): Promise<ChatMessage | null> {
  if (!(await ownedThread(owner, threadId))) return null;
  const id = crypto.randomUUID();
  const t = now();
  await db()
    .prepare("INSERT INTO vera_messages (id,thread_id,role,kind,content,payload,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, threadId, msg.role, msg.kind, msg.content, msg.payload === undefined ? null : JSON.stringify(msg.payload), t)
    .run();
  await db().prepare("UPDATE vera_threads SET updated_at=? WHERE id=?").bind(t, threadId).run();
  return { id, threadId, role: msg.role, kind: msg.kind, content: msg.content, payload: msg.payload ?? null, createdAt: t };
}

export async function renameThread(owner: string, threadId: string, title: string): Promise<boolean> {
  if (!(await ownedThread(owner, threadId))) return false;
  await db().prepare("UPDATE vera_threads SET title=?, updated_at=? WHERE id=?").bind(title.slice(0, 80), now(), threadId).run();
  return true;
}
