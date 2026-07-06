"use client";

// Notification Center data: inbox + unread badge + price alerts, polled gently.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authHeader } from "@/lib/authedFetch";
import type { Notification, PriceAlert } from "@/lib/server/notifyStore";

async function authed<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...(await authHeader()) } });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => authed<{ notifications: Notification[]; unread: number }>("/api/notifications"),
  });
}

export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: ["alerts"],
    enabled,
    staleTime: 30_000,
    queryFn: () => authed<{ alerts: PriceAlert[] }>("/api/alerts"),
  });
}

export function useNotifyActions() {
  const qc = useQueryClient();
  return {
    markAllRead: async () => {
      await authed("/api/notifications", { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    createAlert: async (a: { symbol: string; direction: "above" | "below"; threshold: number }) => {
      await authed("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(a),
      });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    deleteAlert: async (id: number) => {
      await authed(`/api/alerts?id=${id}`, { method: "DELETE" });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  };
}
