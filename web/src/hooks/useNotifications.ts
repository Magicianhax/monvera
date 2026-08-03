"use client";

// Notification Center data: inbox + unread badge + price alerts, polled gently.
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { authHeader } from "@/lib/authedFetch";
import type { Notification, PriceAlert } from "@/lib/server/notifyStore";

async function authed<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...(await authHeader()) } });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

// Same freshness policy as the money reads (LIVE_BALANCE_OPTS in useBalances):
// cron-fired triggers and Vera-chat-created alerts land server-side while the
// canvas is open, so these lists must keep re-reading on their own — a calm
// poll plus refetch on focus/reconnect — instead of waiting for a remount.
// Writes below invalidate immediately, so the poll is only a safety net.
const LIVE_NOTIFY_OPTS = {
  staleTime: 15_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  // Keep the last list on screen across refetches so it never blanks mid-update.
  placeholderData: keepPreviousData,
} as const;

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    enabled,
    ...LIVE_NOTIFY_OPTS,
    queryFn: () => authed<{ notifications: Notification[]; unread: number }>("/api/notifications"),
  });
}

export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: ["alerts"],
    enabled,
    ...LIVE_NOTIFY_OPTS,
    queryFn: () => authed<{ alerts: PriceAlert[] }>("/api/alerts"),
  });
}

// Each write invalidates its key in a `finally`, not just on success: a request
// that throws may still have landed server-side (network dropped after the
// commit), so re-reading the truth is right in both directions. The throw
// still propagates — callers show their own inline error.
export function useNotifyActions() {
  const qc = useQueryClient();
  return {
    markAllRead: async () => {
      try {
        await authed("/api/notifications", { method: "POST" });
      } finally {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      }
    },
    createAlert: async (a: { symbol: string; direction: "above" | "below"; threshold: number }) => {
      try {
        await authed("/api/alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(a),
        });
      } finally {
        void qc.invalidateQueries({ queryKey: ["alerts"] });
      }
    },
    deleteAlert: async (id: number) => {
      try {
        await authed(`/api/alerts?id=${id}`, { method: "DELETE" });
      } finally {
        void qc.invalidateQueries({ queryKey: ["alerts"] });
      }
    },
  };
}
