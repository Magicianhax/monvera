"use client";

// Notifications canvas — the classic Notification Center, chat-native: the
// inbox (fills, autopilot runs, alert triggers) + price alerts management.
// Same real endpoints as the classic app: /api/notifications, /api/alerts.
import { useState } from "react";
import { useNotifications, useAlerts, useNotifyActions } from "@/hooks/useNotifications";
import { relTime, txUrl } from "@/lib/format";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { PIcon, priceStr, type ChatNav } from "./chatKit";

const KIND_ICON: Record<string, string> = {
  fill: "ph-check-circle", alert: "ph-bell", autopilot: "ph-sliders-horizontal",
  send: "ph-paper-plane-tilt", receive: "ph-qr-code", system: "ph-sparkle",
};

export function AlertsCanvas({ nav }: { nav: ChatNav }) {
  const { data: notif } = useNotifications();
  const { data: alerts } = useAlerts();
  const { markAllRead, deleteAlert } = useNotifyActions();
  const [busy, setBusy] = useState(false);
  // Failed writes surface here instead of dying silently — the hook re-reads
  // the true state either way, so the list snaps back to what the server has.
  const [error, setError] = useState<string | null>(null);

  const items = notif?.notifications ?? [];
  const unread = notif?.unread ?? 0;
  const alertRows = alerts?.alerts ?? [];

  return (
    <div>
      {error && (
        <div style={{ margin: "0 4px 10px", background: "color-mix(in srgb,var(--neg) 10%,transparent)", border: "1px solid color-mix(in srgb,var(--neg) 30%,transparent)", borderRadius: 12, padding: "10px 13px", fontSize: 12.5, color: "var(--neg)", lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      {/* inbox */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 6px" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Inbox{unread > 0 ? ` · ${unread} new` : ""}</span>
        {unread > 0 && (
          <button
            onClick={async () => {
              if (busy) return;
              setBusy(true); setError(null);
              try { await markAllRead(); }
              catch { setError("Couldn't mark everything read — try again."); }
              finally { setBusy(false); }
            }}
            style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", opacity: busy ? 0.6 : 1 }}
          >
            Mark all read
          </button>
        )}
      </div>
      <div style={{ padding: "0 4px" }}>
        {items.length === 0 && (
          <div style={{ padding: "18px 2px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Nothing yet. Fills, autopilot runs, triggered price alerts, and news on what you hold all land here.
          </div>
        )}
        {items.slice(0, 30).map((n, i) => {
          const head = (
            <>
              <div style={{ fontSize: 13.5, fontWeight: n.readAt ? 500 : 650 }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45, marginTop: 1 }}>{n.body}</div>}
            </>
          );
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 2px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)", opacity: n.readAt ? 0.7 : 1 }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, flex: "none", display: "grid", placeItems: "center", background: n.readAt ? "var(--panel-2)" : "var(--primary-soft)", color: n.readAt ? "var(--ink-3)" : "var(--primary)" }}>
                <PIcon name={KIND_ICON[n.kind] ?? "ph-sparkle"} size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Symbol-carrying rows (fills, price alerts, autopilot, news) open
                    that holding — the same call the price-alert row below makes.
                    Rows without a symbol stay inert: a dead affordance is worse
                    than none. The receipt link stays OUTSIDE this button; an
                    anchor nested in a button is not independently clickable. */}
                {n.symbol
                  ? <button onClick={() => nav.openCanvas("holding", n.symbol!)} style={{ textAlign: "left", width: "100%", background: "transparent" }}>{head}</button>
                  : head}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                  <span className="tnum" style={{ fontSize: 11, color: "var(--ink-3)" }}>{relTime(Math.floor(n.createdAt / 1000))}</span>
                  {n.txHash && (
                    <a href={txUrl(n.txHash)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--ink-3)", textDecoration: "none" }}>
                      receipt <PIcon name="ph-arrow-square-out" size={10} />
                    </a>
                  )}
                </div>
              </div>
              {!n.readAt && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", flex: "none", marginTop: 5 }} />}
            </div>
          );
        })}
      </div>

      {/* price alerts */}
      <div style={{ marginTop: 18, padding: "0 4px" }}>
        <div style={{ padding: "0 0 6px", fontSize: 13.5, fontWeight: 700 }}>Price alerts</div>
        {alertRows.length === 0 && (
          <div style={{ padding: "4px 2px 10px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            None set — open any stock and tap &ldquo;Alert me&rdquo; to get pinged when it crosses your price.
          </div>
        )}
        {alertRows.map((a, i) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 2px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)", opacity: a.active ? 1 : 0.6 }}>
            <button onClick={() => nav.openCanvas("holding", a.symbol)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textAlign: "left" }}>
              <AssetTile asset={toTile(a.symbol)} size={30} radius={9} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{a.symbol} {a.direction === "above" ? "≥" : "≤"} {priceStr(a.threshold)}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>{a.active ? "Watching" : a.triggeredAt ? "Triggered " + relTime(Math.floor(a.triggeredAt / 1000)) : "Off"}</span>
              </span>
            </button>
            <button
              onClick={async () => {
                if (busy) return;
                setBusy(true); setError(null);
                try { await deleteAlert(a.id); }
                catch { setError("Couldn't delete that alert — try again."); }
                finally { setBusy(false); }
              }}
              aria-label="Delete alert"
              style={{ width: 30, height: 30, flex: "none", border: "1px solid var(--line)", borderRadius: 9, display: "grid", placeItems: "center", background: "transparent", color: "var(--neg)", opacity: busy ? 0.6 : 1 }}
            >
              <PIcon name="ph-x" size={13} weight="bold" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
