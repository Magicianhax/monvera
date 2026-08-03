"use client";

// Full chat history — a wide modal (same proportions as Settings) listing
// every session with Vera, searchable by title. Click a session to jump back
// into it. Data is the same persisted vera_threads the sidebar shows.
import { useEffect, useMemo, useState } from "react";
import type { useVeraChat } from "@/hooks/useVeraChat";
import { PIcon, relDay } from "./chatKit";

export function HistoryPopup({ chat, onPick, onClose }: {
  chat: ReturnType<typeof useVeraChat>;
  /** Called with the chosen thread id — the shell activates it and shows chat. */
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 190);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needle = q.trim().toLowerCase();
  const list = useMemo(
    () => (needle ? chat.threads.filter((t) => t.title.toLowerCase().includes(needle)) : chat.threads),
    [chat.threads, needle],
  );

  return (
    <div
      className={closing ? "fadein fadeout" : "fadein"}
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(8,14,10,.22)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        className={closing ? "glassin glassout" : "glassin"}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 760, background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 55%), var(--panel), var(--bg)", backdropFilter: "blur(14px) saturate(170%)", WebkitBackdropFilter: "blur(14px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 22, boxShadow: "0 20px 60px rgba(8,20,12,.3)", overflow: "hidden" }}
      >
        {/* header + search */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}>
            <PIcon name="ph-clock-counter-clockwise" size={17} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, flex: "none" }}>History</span>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--panel-2)", borderRadius: 12, padding: "8px 12px" }}>
            <PIcon name="ph-magnifying-glass" size={15} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your sessions…"
              autoFocus
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 13.5, fontFamily: "inherit" }}
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="Clear search" style={{ display: "grid", placeItems: "center", color: "var(--ink-3)" }}>
                <PIcon name="ph-x" size={13} weight="bold" />
              </button>
            )}
          </div>
          <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>

        {/* sessions — two columns on the wide modal, one on small screens */}
        <div className="scr" style={{ padding: "14px 18px 18px", maxHeight: "68vh", overflowY: "auto" }}>
          {list.length === 0 ? (
            <div style={{ padding: "28px 0", textAlign: "center", fontSize: 13, color: "var(--ink-3)" }}>
              {needle ? `Nothing matches "${q.trim()}".` : "Your sessions with Vera will appear here."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 6 }}>
              {list.map((t) => {
                const on = chat.activeId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { onPick(t.id); close(); }}
                    style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 13, textAlign: "left", border: `1px solid ${on ? "var(--primary)" : "var(--line-2)"}`, background: on ? "var(--primary-soft)" : "transparent" }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: on ? "var(--primary)" : "var(--ink-3)" }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 550, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{relDay(t.updatedAt)}</span>
                    </span>
                    <PIcon name="ph-caret-right" size={13} weight="bold" style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
