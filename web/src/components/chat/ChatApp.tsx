"use client";

// Monvera chat-first shell (the "Monvera Chat" design, desktop ≥761px).
// Layout: left sidebar (Vera brand, nav, canvas launchers, HISTORY = persisted
// vera_threads) · center (home menu | chat) · right canvas (contextual panel).
// Overlays: order ticket, send/receive, settings. Vera's history lives in D1
// via useVeraChat; the intelligence itself stays on the existing invest rails.
import { useCallback, useEffect, useRef, useState } from "react";
import { readAppUrl, writeAppUrl, isCanvasTab } from "./appUrl";
import { useTheme } from "@/hooks/useTheme";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useVeraChat } from "@/hooks/useVeraChat";
import { groveById } from "@/lib/groves";
import { CHAT_THEME_CSS, CHAT_STYLE_CSS, CANVAS_META, ChatOrb, ChatMark, PIcon, type CanvasType, type ChatNav } from "./chatKit";
import { useColorStyle } from "@/hooks/useColorStyle";
import { useNotifications } from "@/hooks/useNotifications";
import { useWatchlistSync } from "@/hooks/useWatchlistSync";
import { ChatCenter, type ChatCenterHandle } from "./ChatCenter";
import { HomeMenu } from "./HomeMenu";
import { GrovesPage } from "./GrovesPage";
import { CanvasBody } from "./CanvasBody";
import { OrderTicket, type OrderState } from "./OrderTicket";
import { TokenOrderTicket } from "./TokenOrderTicket";
import { PaySheet, type PayMode } from "./PaySheet";
import { SettingsPopup } from "./SettingsPopup";
import { HistoryPopup } from "./HistoryPopup";
import { displayFor } from "@/lib/displayAssets";

const LAUNCHERS: [CanvasType, string, string][] = [
  ["portfolio", "Portfolio", "ph-chart-pie-slice"],
  ["market", "Market", "ph-squares-four"],
  ["wallet", "Wallet", "ph-wallet"],
  ["token", "$MONVERA", "ph-coin"],
  ["autopilot", "Autopilot", "ph-sliders-horizontal"],
  ["vera", "Track record", "ph-seal-check"],
  ["scan", "Scan", "ph-camera"],
  ["insights", "Insights", "ph-lightbulb"],
  ["activity", "Activity", "ph-clock-counter-clockwise"],
  ["alerts", "Notifications", "ph-bell"],
];

export function ChatApp() {
  const { colorMode, setColorMode } = useTheme();
  const { colorStyle } = useColorStyle();
  const { address } = useSmartAccount();
  const chat = useVeraChat(!!address);
  useWatchlistSync();
  const { data: notif } = useNotifications(!!address);
  const unread = notif?.unread ?? 0;

  const [home, setHome] = useState<"menu" | "chat">("menu");
  const [navExpanded, setNavExpanded] = useState(true);
  const [canvas, setCanvas] = useState<CanvasType | null>(null);
  const [canvasSymbol, setCanvasSymbol] = useState("AAPL");
  const [canvasClosing, setCanvasClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [order, setOrder] = useState<OrderState | null>(null);
  const [payMode, setPayMode] = useState<PayMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Wide canvas: one degree of freedom for big screens — the aside fills the
  // center (chat yields) instead of every browse surface living in 486px.
  const [canvasWide, setCanvasWide] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("mv.canvasWide") === "1"; } catch { return false; }
  });
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  // In-app Groves surface — a FULL-PAGE takeover of the center (chat/menu come
  // back untouched when it closes). null = closed; id null = the shelf.
  const [grovesView, setGrovesView] = useState<{ id: string | null; auto: boolean } | null>(null);

  // /groves deep link: the public Grove pages' CTAs land on "/app?grove=<id>"
  // (+ "&auto=1" for auto-manage) — open that Grove's in-app page and strip
  // the params so a refresh doesn't re-open. Runs once per mount.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = groveById((q.get("grove") ?? "").toLowerCase());
    if (!g) return;
    const auto = q.get("auto") === "1";
    q.delete("grove");
    q.delete("auto");
    const rest = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    setGrovesView({ id: g.id, auto });
  }, []);

  // Restore the view from the URL on load, then keep the URL in sync so a
  // refresh (or a shared link) lands back on the same page.
  useEffect(() => {
    const u = readAppUrl();
    if (!u.tab) return;
    if (u.tab === "chat") setHome("chat");
    else if (u.tab === "groves") setGrovesView({ id: u.id && groveById(u.id) ? u.id : null, auto: false });
    else if (isCanvasTab(u.tab)) {
      if (u.tab === "holding" && u.sym) setCanvasSymbol(u.sym.toUpperCase());
      setCanvas(u.tab as CanvasType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // State → URL. The first run is skipped (mount is the restore effect's job,
  // and pushing there would bury the entry the visitor arrived on); afterwards
  // every view change pushes a history entry so back walks through the app.
  const urlSynced = useRef(false);
  useEffect(() => {
    if (!urlSynced.current) { urlSynced.current = true; return; }
    if (grovesView) writeAppUrl({ tab: "groves", id: grovesView.id });
    else if (canvas) writeAppUrl({ tab: canvas, sym: canvas === "holding" ? canvasSymbol : null });
    else writeAppUrl({ tab: home === "chat" ? "chat" : null });
  }, [home, canvas, canvasSymbol, grovesView]);

  // Back/forward: re-apply whatever view the restored URL describes. The sync
  // effect then no-ops because the URL already matches the applied state.
  useEffect(() => {
    const onPop = () => {
      const u = readAppUrl();
      if (u.tab === "groves") setGrovesView({ id: u.id && groveById(u.id) ? u.id : null, auto: false });
      else setGrovesView(null);
      if (u.tab && isCanvasTab(u.tab)) {
        if (u.tab === "holding" && u.sym) setCanvasSymbol(u.sym.toUpperCase());
        setCanvas(u.tab as CanvasType);
        setCanvasClosing(false);
      } else {
        setCanvas(null);
        setCanvasClosing(false);
      }
      // Canvas entries overlay chat/menu — leave the layer beneath untouched.
      if (u.tab === "chat") setHome("chat");
      else if (!u.tab) setHome("menu");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Exit mirrors the entrance (slides back out right, slightly faster), so the
  // canvas leaves the way it came instead of vanishing.
  const dismissCanvas = () => {
    if (closeTimer.current) return;
    setCanvasClosing(true);
    closeTimer.current = setTimeout(() => { setCanvas(null); setCanvasClosing(false); closeTimer.current = null; }, 210);
  };

  const nav: ChatNav = {
    openCanvas: (t, sym) => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setCanvasClosing(false);
      setCanvas(t);
      if (sym) setCanvasSymbol(sym);
    },
    closeCanvas: dismissCanvas,
    goChat: () => { setHome("chat"); setGrovesView(null); },
    goMenu: () => { setHome("menu"); setGrovesView(null); dismissCanvas(); },
    openBuy: (symbol) => setOrder({ symbol, side: "buy" }),
    openSell: (symbol) => setOrder({ symbol, side: "sell" }),
    askVera: (text) => { setHome("chat"); setGrovesView(null); setPendingAsk(text); },
    openGroves: (id, opts) => { dismissCanvas(); setGrovesView({ id: id ?? null, auto: !!opts?.auto }); },
    openSend: () => setPayMode("send"),
    openReceive: () => setPayMode("receive"),
    openSettings: () => setSettingsOpen(true),
  };

  const consumeAsk = useCallback(() => setPendingAsk(null), []);

  const meta = canvas ? CANVAS_META[canvas] : null;
  const canvasTitle = canvas === "holding" ? displayFor(canvasSymbol).name : meta?.title;
  const canvasSub = canvas === "holding" ? `${canvasSymbol} · ${displayFor(canvasSymbol).cat ?? ""}` : meta?.sub;

  const navBtn = (on: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 11, height: 36, padding: "0 10px", borderRadius: 10, flex: "none",
    background: on ? "var(--primary-soft)" : "transparent", color: on ? "var(--primary)" : "var(--ink-2)",
  });
  const label = (text: string) => (navExpanded ? <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>{text}</span> : null);

  return (
    <div className="mvc" data-mode={colorMode} data-style={colorStyle} style={{ height: "100dvh", width: "100%", display: "flex", fontFamily: "var(--font-ui)", color: "var(--ink)", background: "var(--bg)", overflow: "hidden", fontSize: 15 }}>
      <style dangerouslySetInnerHTML={{ __html: CHAT_THEME_CSS + CHAT_STYLE_CSS }} />

      {/* ── left sidebar ── */}
      <nav style={{ flex: "none", width: navExpanded ? 252 : 78, display: "flex", flexDirection: "column", padding: "12px 10px", borderRight: "1px solid var(--line)", background: "var(--panel-2)", backdropFilter: "blur(24px) saturate(170%)", WebkitBackdropFilter: "blur(24px) saturate(170%)", minHeight: 0, transition: "width .22s cubic-bezier(.32,.72,0,1)" }}>
        <button onClick={nav.goMenu} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 8px", flex: "none", textAlign: "left" }}>
          <ChatOrb size={38} style={{ animation: "mvcspin 7s linear infinite" }} />
          {navExpanded && (
            <div style={{ minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1 }}>Vera</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}>by</span>
                <ChatMark size={13} />
                <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 600 }}>Monvera</span>
              </div>
            </div>
          )}
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "none" }}>
          <button onClick={() => setNavExpanded((v) => !v)} title={navExpanded ? "Collapse" : "Expand"} style={{ ...navBtn(false), color: "var(--ink-3)" }}>
            <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-list" size={17} weight="bold" /></span>
            {navExpanded && <span style={{ fontSize: 13, fontWeight: 600 }}>Collapse</span>}
          </button>
          <button onClick={nav.goMenu} title="Home" style={navBtn(home === "menu")}>
            <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-house" size={19} /></span>
            {label("Home")}
          </button>
          <button onClick={nav.goChat} title="Chat with Vera" style={navBtn(home === "chat")}>
            <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-chats-circle" size={19} /></span>
            {label("Vera")}
          </button>
          {home === "chat" && (
            <button onClick={() => { chat.newSession(); setHome("chat"); }} title="New session" style={{ display: "flex", alignItems: "center", gap: 11, height: 32, marginLeft: navExpanded ? 14 : 0, padding: "0 9px", borderRadius: 10, background: "var(--primary-soft)", color: "var(--primary)", flex: "none" }}>
              <span style={{ width: 20, display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-plus-circle" size={17} weight="bold" /></span>
              {navExpanded && <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>New session</span>}
            </button>
          )}
          {/* Groves is a full page, not a canvas — its own entry above the canvas launchers */}
          <button onClick={() => nav.openGroves()} title="Groves" style={navBtn(grovesView !== null)}>
            <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none" }}>
              <PIcon name="ph-tree" size={19} />
            </span>
            {label("Groves")}
          </button>
          {LAUNCHERS.map(([id, lbl, icon]) => (
            <button key={id} onClick={() => nav.openCanvas(id)} title={lbl} style={navBtn(canvas === id)}>
              <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none", position: "relative" }}>
                <PIcon name={icon} size={19} />
                {id === "alerts" && unread > 0 && <span aria-hidden style={{ position: "absolute", top: -1, right: -2, width: 8, height: 8, borderRadius: "50%", background: "var(--neg)", border: "1.5px solid var(--bg)" }} />}
              </span>
              {label(id === "alerts" && unread > 0 ? `${lbl} · ${unread}` : lbl)}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: "var(--line)", margin: "10px 6px", flex: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 11, height: 30, padding: "0 9px", flex: "none" }}>
          <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none", color: "var(--ink-3)" }}><PIcon name="ph-clock-counter-clockwise" size={19} /></span>
          {navExpanded && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" }}>History</span>}
          {navExpanded && chat.threads.length > 0 && (
            <button onClick={() => setHistoryOpen(true)} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 650, color: "var(--primary)", padding: "3px 7px", borderRadius: 8 }}>
              View all
            </button>
          )}
        </div>
        {navExpanded ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {chat.threads.map((t) => (
              <button key={t.id} onClick={() => { chat.setActiveId(t.id); setHome("chat"); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 10px", borderRadius: 11, textAlign: "left", background: chat.activeId === t.id ? "var(--panel-2)" : "transparent" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: chat.activeId === t.id ? "var(--primary)" : "var(--ink-3)" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{relDay(t.updatedAt)}</span>
                </span>
              </button>
            ))}
            {chat.threads.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-3)" }}>Your sessions with Vera will appear here.</div>}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 2, paddingTop: 8, borderTop: "1px solid var(--line-2)" }}>
          <button onClick={() => setColorMode(colorMode === "light" ? "dark" : "light")} title={colorMode === "light" ? "Dark mode" : "Light mode"} style={{ ...navBtn(false) }}>
            <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none" }}><PIcon name={colorMode === "light" ? "ph-moon" : "ph-sun"} size={20} /></span>
            {label(colorMode === "light" ? "Dark mode" : "Light mode")}
          </button>
          <button onClick={() => setSettingsOpen(true)} title="Settings" style={{ ...navBtn(false) }}>
            <span style={{ width: 22, display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-gear-six" size={20} /></span>
            {label("Settings")}
          </button>
        </div>
      </nav>

      {/* ── center (Groves takes the whole surface over; back restores it) ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {grovesView
          ? <GrovesPage groveId={grovesView.id} autoManage={grovesView.auto} nav={nav} onOpen={(id) => setGrovesView({ id, auto: false })} onBack={() => setGrovesView(grovesView.id ? { id: null, auto: false } : null)} />
          : home === "menu" ? <HomeMenu nav={nav} /> : <ChatCenter nav={nav} chat={chat} narrowed={!!canvas} pendingAsk={pendingAsk} consumeAsk={consumeAsk} />}
      </div>

      {/* ── right canvas ── */}
      {canvas && meta && (
        <aside className={canvasClosing ? "canv canv-out" : "canv"} style={{ flex: canvasWide ? 1 : "none", width: canvasWide ? "auto" : 486, minWidth: canvasWide ? 0 : undefined, borderLeft: "1px solid var(--line)", background: "var(--panel-2)", backdropFilter: "blur(24px) saturate(170%)", WebkitBackdropFilter: "blur(24px) saturate(170%)", display: "flex", flexDirection: "column", minHeight: 0, transition: "width .28s ease" }}>
          <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ width: 40, height: 40, borderRadius: 13, flex: "none", display: "grid", placeItems: "center", background: "linear-gradient(145deg,var(--primary-2),var(--primary))", color: "#fff", boxShadow: "0 6px 14px color-mix(in srgb, var(--primary) 32%, transparent)" }}>
                <PIcon name={canvas === "holding" ? "ph-chart-line-up" : meta.icon} size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{canvasTitle}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>{canvasSub}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flex: "none" }}>
              <button onClick={() => setCanvasWide((w) => { try { localStorage.setItem("mv.canvasWide", w ? "0" : "1"); } catch { /* fine */ } return !w; })} aria-label={canvasWide ? "Narrow panel" : "Expand panel"} title={canvasWide ? "Narrow" : "Expand"} style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}>
                <PIcon name={canvasWide ? "ph-corners-in" : "ph-corners-out"} size={16} weight="bold" />
              </button>
              <button onClick={nav.closeCanvas} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}><PIcon name="ph-x" size={16} weight="bold" /></button>
            </div>
          </div>
          <div className="stag" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
            <div style={{ maxWidth: canvasWide ? 860 : undefined, margin: canvasWide ? "0 auto" : undefined }}>
              <CanvasBody type={canvas} symbol={canvasSymbol} nav={nav} />
            </div>
          </div>
        </aside>
      )}

      {/* ── overlays ── */}
      {order && (order.symbol === "MONVERA"
        ? <TokenOrderTicket order={order} onClose={() => setOrder(null)} nav={nav} />
        : <OrderTicket order={order} onClose={() => setOrder(null)} nav={nav} />)}
      {payMode && <PaySheet mode={payMode} onClose={() => setPayMode(null)} />}
      {settingsOpen && <SettingsPopup onClose={() => setSettingsOpen(false)} nav={nav} />}
      {historyOpen && <HistoryPopup chat={chat} onPick={(id) => { chat.setActiveId(id); setHome("chat"); }} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

export type { ChatCenterHandle };

function relDay(unix: number): string {
  const d = Math.max(0, Date.now() / 1000 - unix);
  if (d < 3600) return "Just now";
  if (d < 86400) return "Today";
  if (d < 2 * 86400) return "Yesterday";
  if (d < 7 * 86400) return Math.round(d / 86400) + " days ago";
  return Math.round(d / (7 * 86400)) + " week" + (d >= 14 * 86400 ? "s" : "") + " ago";
}
