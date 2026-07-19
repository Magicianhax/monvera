"use client";

// Vera chat history — client side. Threads + messages live in D1 behind
// /api/vera-chat (bound to the verified Privy user). This hook is pure
// persistence + cache: the chat surface orchestrates the actual intelligence
// (useInvest.allocate / invest) and appends both sides here, optimistically.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { authHeader } from "@/lib/authedFetch";

export type ChatRole = "user" | "vera";
export type ChatKind = "text" | "plan" | "success" | "portfolio" | "review" | "sellReceipt" | "quote";

export interface ChatThread { id: string; title: string; createdAt: number; updatedAt: number }
export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  kind: ChatKind;
  content: string;
  payload: unknown | null;
  createdAt: number;
  /** Client-only: message not yet confirmed by the server. */
  pending?: boolean;
}

async function api<T>(init?: RequestInit & { query?: string }): Promise<T> {
  const res = await fetch(`/api/vera-chat${init?.query ?? ""}`, {
    ...init,
    headers: { "content-type": "application/json", ...(await authHeader()), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`vera-chat ${res.status}`);
  return (await res.json()) as T;
}

export function useVeraChat(enabled: boolean) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const threadsQ = useQuery({
    queryKey: ["vera-threads"],
    queryFn: () => api<{ threads: ChatThread[] }>().then((r) => r.threads),
    enabled,
    staleTime: 30_000,
  });

  const messagesQ = useQuery({
    queryKey: ["vera-messages", activeId],
    queryFn: () => api<{ messages: ChatMessage[] }>({ query: `?thread=${activeId}` }).then((r) => r.messages),
    enabled: enabled && !!activeId,
    staleTime: 10_000,
  });

  /** Create a thread (titled from the first user message) and select it. */
  const createThread = useCallback(
    async (title: string): Promise<ChatThread> => {
      const { thread } = await api<{ thread: ChatThread }>({ method: "POST", body: JSON.stringify({ op: "create", title: title.slice(0, 80) }) });
      qc.setQueryData<ChatThread[]>(["vera-threads"], (t) => [thread, ...(t ?? [])]);
      setActiveId(thread.id);
      return thread;
    },
    [qc],
  );

  /** Optimistically add a message to the active thread's cache and persist it. */
  const append = useMutation({
    mutationFn: async (m: { threadId: string; role: ChatRole; kind?: ChatKind; content?: string; payload?: unknown }) => {
      const { message } = await api<{ message: ChatMessage }>({
        method: "POST",
        body: JSON.stringify({ op: "append", threadId: m.threadId, role: m.role, kind: m.kind ?? "text", content: m.content ?? "", payload: m.payload }),
      });
      return message;
    },
    onMutate: async (m) => {
      const key = ["vera-messages", m.threadId];
      const optimistic: ChatMessage = {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        threadId: m.threadId,
        role: m.role,
        kind: m.kind ?? "text",
        content: m.content ?? "",
        payload: m.payload ?? null,
        createdAt: Math.floor(Date.now() / 1000),
        pending: true,
      };
      qc.setQueryData<ChatMessage[]>(key, (msgs) => [...(msgs ?? []), optimistic]);
      return { key, tmpId: optimistic.id };
    },
    onSuccess: (message, _m, ctx) => {
      if (!ctx) return;
      qc.setQueryData<ChatMessage[]>(ctx.key, (msgs) => (msgs ?? []).map((x) => (x.id === ctx.tmpId ? message : x)));
      qc.setQueryData<ChatThread[]>(["vera-threads"], (t) =>
        (t ?? [])
          .map((th) => (th.id === message.threadId ? { ...th, updatedAt: message.createdAt } : th))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    },
    onError: (_e, _m, ctx) => {
      if (ctx) qc.setQueryData<ChatMessage[]>(ctx.key, (msgs) => (msgs ?? []).filter((x) => x.id !== ctx.tmpId));
    },
  });

  const newSession = useCallback(() => setActiveId(null), []);

  return {
    threads: threadsQ.data ?? [],
    threadsLoading: threadsQ.isLoading,
    activeId,
    setActiveId,
    messages: activeId ? (messagesQ.data ?? []) : [],
    messagesLoading: !!activeId && messagesQ.isLoading,
    createThread,
    append: append.mutateAsync,
    newSession,
  };
}
