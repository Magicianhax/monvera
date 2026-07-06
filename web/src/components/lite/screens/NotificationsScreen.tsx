"use client";

// Notification Center — the bell's inbox: alerts that fired, autopilot runs,
// trade updates; plus management of the user's active price alerts.
import { useEffect } from "react";
import { Icon, type IconName } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { useNotifications, useAlerts, useNotifyActions } from "@/hooks/useNotifications";
import { displayFor } from "@/lib/displayAssets";
import { usd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { iconBtn, boxHead, innerBox, Spinner } from "./primitives";

const KIND_ICON: Record<string, IconName> = { alert: "bell", autopilot: "spark", trade: "receipt", system: "info" };

function ago(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationsScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { data, isLoading } = useNotifications();
  const { data: alertData } = useAlerts();
  const { markAllRead, deleteAlert } = useNotifyActions();

  // Opening the inbox clears the badge (after the list is on screen).
  useEffect(() => {
    if (data && data.unread > 0) void markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.unread]);

  const items = data?.notifications ?? [];
  const alerts = (alertData?.alerts ?? []).filter((a) => a.active);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Notifications</h1>
      </div>

      <div className="anim-rise" style={{ padding: "16px 22px 0" }}>
        {isLoading ? (
          <div style={{ display: "grid", placeItems: "center", padding: 40 }}><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>Nothing yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Price alerts, Autopilot runs, and trade updates will land here.
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((n) => (
              <button
                key={n.id}
                className="tap"
                style={{ ...innerBox, opacity: n.readAt ? 0.75 : 1 }}
                onClick={() => {
                  haptic.select();
                  if (n.symbol) go("asset", { symbol: n.symbol });
                  else if (n.txHash) go("receipt", { txHash: n.txHash });
                }}
              >
                {n.symbol ? (
                  <TokenLogo symbol={n.symbol} size={34} />
                ) : (
                  <span style={{ width: 34, height: 34, borderRadius: "var(--r-sm)", flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}>
                    <Icon name={KIND_ICON[n.kind] ?? "info"} size={17} />
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>{ago(n.createdAt)}</div>
                </div>
                {!n.readAt && <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--primary)", flex: "none" }} />}
              </button>
            ))}
          </div>
        )}

        {/* active price alerts */}
        <div style={{ marginTop: 22 }}>
          <div style={boxHead}>Your price alerts</div>
          {alerts.length === 0 ? (
            <div className="card" style={{ padding: "18px 16px", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              None yet. Open any stock and tap the bell to get notified at a price you choose.
            </div>
          ) : (
            <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {alerts.map((a) => (
                <div key={a.id} style={innerBox}>
                  <TokenLogo symbol={a.symbol} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      {displayFor(a.symbol).name} {a.direction} {usd(a.threshold)}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>Checked every 15 minutes</div>
                  </div>
                  <button
                    className="tap"
                    aria-label="Remove alert"
                    onClick={() => { haptic.light(); void deleteAlert(a.id); }}
                    style={{ width: 34, height: 34, borderRadius: 99, display: "grid", placeItems: "center", background: "var(--surface-2)", color: "var(--ink-3)", flex: "none" }}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
