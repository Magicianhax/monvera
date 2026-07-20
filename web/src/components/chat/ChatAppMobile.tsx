"use client";

// Monvera chat-first shell — PHONE (≤760px), the "Monvera Chat Mobile" design.
// Same brains as the desktop ChatApp (useVeraChat + the invest rails), phone
// composition: top bar, home|chat, floating bottom nav, a push-in left drawer
// (History + canvas launchers + settings/logout), and full-screen canvas sheets.
// The canvas bodies, conversation, and overlays are REUSED from the desktop
// build (they're scope-agnostic — CSS vars carry the .mvm theme).
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { readAppUrl, writeAppUrl, isCanvasTab } from "./appUrl";
import { useTheme } from "@/hooks/useTheme";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useMonveraPrice } from "@/hooks/useMonveraToken";
import { useVeraChat } from "@/hooks/useVeraChat";
import { groveById } from "@/lib/groves";
import { CHAT_THEME_CSS, CHAT_STYLE_CSS, CANVAS_META, ChatOrb, ChatMark, PIcon, priceStr, type CanvasType, type ChatNav } from "./chatKit";
import { useColorStyle } from "@/hooks/useColorStyle";
import { useNotifications } from "@/hooks/useNotifications";
import { useWatchlistSync } from "@/hooks/useWatchlistSync";
import { HomeMobile } from "./HomeMobile";
import { ChatCenter } from "./ChatCenter";
import type { OrderState } from "./OrderTicket";
import type { PayMode } from "./PaySheet";
import { InstallPrompt } from "@/components/app/InstallPrompt";

// Tap-to-open surfaces, deferred — same rationale as the desktop shell, and it
// matters more on a phone: opening the app must not download every sheet.
const GrovesPage = dynamic(() => import("./GrovesPage").then((m) => m.GrovesPage), { ssr: false });
const CanvasBody = dynamic(() => import("./CanvasBody").then((m) => m.CanvasBody), { ssr: false });
const OrderTicket = dynamic(() => import("./OrderTicket").then((m) => m.OrderTicket), { ssr: false });
const TokenOrderTicket = dynamic(() => import("./TokenOrderTicket").then((m) => m.TokenOrderTicket), { ssr: false });
const PaySheet = dynamic(() => import("./PaySheet").then((m) => m.PaySheet), { ssr: false });
const SettingsPopup = dynamic(() => import("./SettingsPopup").then((m) => m.SettingsPopup), { ssr: false });
const HistoryPopup = dynamic(() => import("./HistoryPopup").then((m) => m.HistoryPopup), { ssr: false });
import { displayFor } from "@/lib/displayAssets";

const DRAWER_ITEMS: [CanvasType, string, string][] = [
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

export function ChatAppMobile() {
  const { colorMode, setColorMode } = useTheme();
  const { colorStyle } = useColorStyle();
  const { address } = useSmartAccount();
  const { data: tok } = useMonveraPrice();
  const chat = useVeraChat(!!address);
  useWatchlistSync();
  const { data: notif } = useNotifications(!!address);
  const unread = notif?.unread ?? 0;

  const [home, setHome] = useState<"menu" | "chat">("menu");
  const [drawer, setDrawer] = useState(false);
  const [canvas, setCanvas] = useState<CanvasType | null>(null);
  const [canvasSymbol, setCanvasSymbol] = useState("AAPL");
  const [sheetClosing, setSheetClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [order, setOrder] = useState<OrderState | null>(null);
  const [payMode, setPayMode] = useState<PayMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  // In-app Groves surface — a full-screen page over the shell (its own sheet,
  // below the canvas sheet so holdings tapped inside it open on top).
  const [grovesView, setGrovesView] = useState<{ id: string | null; auto: boolean } | null>(null);
  const [grovesClosing, setGrovesClosing] = useState(false);
  const grovesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeGroves = () => {
    if (grovesTimer.current || !grovesView) return;
    setGrovesClosing(true);
    grovesTimer.current = setTimeout(() => { setGrovesView(null); setGrovesClosing(false); grovesTimer.current = null; }, 250);
  };

  // True while the mount-time effects below are normalizing the arrival URL —
  // the first URL sync after that must replace, not push (see the sync effect).
  const restoredFromUrl = useRef(false);

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
    restoredFromUrl.current = true;
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
    restoredFromUrl.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // State → URL. The first run is skipped (mount is the restore effect's job).
  // The first run AFTER a mount-time restore replaces instead of pushing — it's
  // only normalizing the arrival URL, and a push there would bury the entry the
  // visitor arrived on. Every later view change pushes a history entry so back
  // walks through the app.
  const urlSynced = useRef(false);
  useEffect(() => {
    if (!urlSynced.current) { urlSynced.current = true; return; }
    const replace = restoredFromUrl.current;
    restoredFromUrl.current = false;
    if (grovesView) writeAppUrl({ tab: "groves", id: grovesView.id }, { replace });
    else if (canvas) writeAppUrl({ tab: canvas, sym: canvas === "holding" ? canvasSymbol : null }, { replace });
    else writeAppUrl({ tab: home === "chat" ? "chat" : null }, { replace });
  }, [home, canvas, canvasSymbol, grovesView]);

  // Back/forward: re-apply whatever view the restored URL describes. The sync
  // effect then no-ops because the URL already matches the applied state.
  useEffect(() => {
    const onPop = () => {
      // Close animations may be mid-flight; their timers would fire AFTER this
      // restore and wipe the very view the user navigated back to.
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      if (grovesTimer.current) { clearTimeout(grovesTimer.current); grovesTimer.current = null; }
      const u = readAppUrl();
      if (u.tab === "groves") {
        setGrovesView({ id: u.id && groveById(u.id) ? u.id : null, auto: false });
        setGrovesClosing(false);
      } else {
        setGrovesView(null);
        setGrovesClosing(false);
      }
      if (u.tab && isCanvasTab(u.tab)) {
        if (u.tab === "holding" && u.sym) setCanvasSymbol(u.sym.toUpperCase());
        setCanvas(u.tab as CanvasType);
        setSheetClosing(false);
      } else {
        setCanvas(null);
        setSheetClosing(false);
      }
      // Canvas entries overlay chat/menu — leave the layer beneath untouched.
      if (u.tab === "chat") setHome("chat");
      else if (!u.tab) setHome("menu");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The sheet leaves the way it came — slides back down, slightly faster.
  const dismissSheet = () => {
    if (closeTimer.current || !canvas) return;
    setSheetClosing(true);
    closeTimer.current = setTimeout(() => { setCanvas(null); setSheetClosing(false); closeTimer.current = null; }, 250);
  };

  const nav: ChatNav = {
    openCanvas: (t, sym) => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setSheetClosing(false);
      setCanvas(t);
      if (sym) setCanvasSymbol(sym);
      setDrawer(false);
    },
    closeCanvas: dismissSheet,
    goChat: () => { setHome("chat"); setDrawer(false); dismissSheet(); closeGroves(); },
    goMenu: () => { setHome("menu"); setDrawer(false); dismissSheet(); closeGroves(); },
    openBuy: (symbol) => setOrder({ symbol, side: "buy" }),
    openSell: (symbol) => setOrder({ symbol, side: "sell" }),
    askVera: (text) => { setHome("chat"); dismissSheet(); closeGroves(); setPendingAsk(text); },
    openGroves: (id, opts) => {
      if (grovesTimer.current) { clearTimeout(grovesTimer.current); grovesTimer.current = null; }
      setGrovesClosing(false);
      setGrovesView({ id: id ?? null, auto: !!opts?.auto });
      setDrawer(false);
      dismissSheet();
    },
    openSend: () => setPayMode("send"),
    openReceive: () => setPayMode("receive"),
    openSettings: () => setSettingsOpen(true),
  };
  const consumeAsk = useCallback(() => setPendingAsk(null), []);

  const meta = canvas ? CANVAS_META[canvas] : null;
  const canvasTitle = canvas === "holding" ? displayFor(canvasSymbol).name : meta?.title;
  const canvasSub = canvas === "holding" ? `${canvasSymbol} · ${displayFor(canvasSymbol).cat ?? ""}` : meta?.sub;

  const navItem = (icon: string, lbl: string, on: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: on ? "var(--primary)" : "var(--ink-3)", padding: "6px 0" }}>
      <PIcon name={icon} size={22} />
      <span style={{ fontSize: 10, fontWeight: on ? 700 : 600 }}>{lbl}</span>
    </button>
  );

  return (
    <div className="mvm" data-mode={colorMode} data-style={colorStyle} style={{ height: "100dvh", width: "100%", maxWidth: 520, margin: "0 auto", position: "relative", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", color: "var(--ink)", background: "var(--bg)", overflow: "hidden", fontSize: 15 }}>
      <style dangerouslySetInnerHTML={{ __html: CHAT_THEME_CSS + CHAT_STYLE_CSS }} />
      {/* phone-gated, snooze-guarded add-to-home-screen invite */}
      <InstallPrompt />

      {/* push-in drawer underneath the shell */}
      <div className="aur" style={{ position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 1, width: 300, display: "flex", flexDirection: "column", padding: "14px 12px", background: "var(--bg)", borderRight: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ChatOrb size={30} />
            <div><div className="serif" style={{ fontSize: 18, fontWeight: 500, lineHeight: 1 }}>Vera</div><div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><span style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 500 }}>by</span><ChatMark size={11} /><span style={{ fontSize: 10, color: "var(--ink-2)", fontWeight: 600 }}>Monvera</span></div></div>
          </div>
          <button onClick={() => setDrawer(false)} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}><PIcon name="ph-x" size={15} weight="bold" /></button>
        </div>
        <button onClick={() => { chat.newSession(); nav.goChat(); }} style={{ display: "flex", alignItems: "center", gap: 11, height: 42, padding: "0 12px", borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary)", marginBottom: 6 }}><PIcon name="ph-plus-circle" size={19} weight="bold" /><span style={{ fontSize: 14, fontWeight: 600 }}>New session</span></button>
        {/* the menu itself stays pinned and roomy; only History scrolls */}
        <div className="scr" style={{ flex: "none", maxHeight: "52%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Groves is a full page, not a canvas — its own entry above the canvas items */}
          <button onClick={() => { nav.openGroves(); }} style={{ display: "flex", alignItems: "center", gap: 13, height: 48, padding: "0 12px", borderRadius: 13, background: grovesView !== null ? "var(--primary-soft)" : "transparent", textAlign: "left", flex: "none" }}>
            <span style={{ width: 26, display: "grid", placeItems: "center", flex: "none", color: grovesView !== null ? "var(--primary)" : "var(--ink-2)" }}><PIcon name="ph-tree" size={23} /></span>
            <span style={{ fontSize: 15.5, fontWeight: 600, color: grovesView !== null ? "var(--primary)" : "var(--ink)" }}>Groves</span>
          </button>
          {DRAWER_ITEMS.map(([id, lbl, icon]) => (
            <button key={id} onClick={() => nav.openCanvas(id)} style={{ display: "flex", alignItems: "center", gap: 13, height: 48, padding: "0 12px", borderRadius: 13, background: canvas === id ? "var(--primary-soft)" : "transparent", textAlign: "left", flex: "none" }}>
              <span style={{ width: 26, display: "grid", placeItems: "center", flex: "none", color: canvas === id ? "var(--primary)" : "var(--ink-2)" }}><PIcon name={icon} size={23} /></span>
              <span style={{ fontSize: 15.5, fontWeight: 600, color: canvas === id ? "var(--primary)" : "var(--ink)" }}>{lbl}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: "none", height: 1, background: "var(--line)", margin: "8px 6px" }} />
        <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ padding: "6px 12px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-3)" }}>History</div>
          {chat.threads.slice(0, 6).map((t) => (
            <button key={t.id} onClick={() => { chat.setActiveId(t.id); nav.goChat(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", borderRadius: 11, textAlign: "left", background: chat.activeId === t.id ? "var(--panel-2)" : "transparent" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: chat.activeId === t.id ? "var(--primary)" : "var(--ink-3)" }} />
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span></span>
            </button>
          ))}
          {chat.threads.length === 0 && <div style={{ padding: "6px 12px", fontSize: 11.5, color: "var(--ink-3)" }}>Your sessions appear here.</div>}
          {chat.threads.length > 6 && (
            <button onClick={() => setHistoryOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px 10px", fontSize: 11.5, fontWeight: 650, color: "var(--primary)" }}>
              View all {chat.threads.length} sessions <PIcon name="ph-caret-right" size={11} weight="bold" />
            </button>
          )}
        </div>
        <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 2, paddingTop: 8, borderTop: "1px solid var(--line-2)" }}>
          <button onClick={() => setColorMode(colorMode === "light" ? "dark" : "light")} style={{ display: "flex", alignItems: "center", gap: 12, height: 42, padding: "0 12px", borderRadius: 12, color: "var(--ink-2)" }}><span style={{ width: 24, display: "grid", placeItems: "center", flex: "none" }}><PIcon name={colorMode === "light" ? "ph-moon" : "ph-sun"} size={20} /></span><span style={{ fontSize: 14, fontWeight: 600 }}>{colorMode === "light" ? "Dark mode" : "Light mode"}</span></button>
          <button onClick={() => { setSettingsOpen(true); setDrawer(false); }} style={{ display: "flex", alignItems: "center", gap: 12, height: 42, padding: "0 12px", borderRadius: 12, color: "var(--ink-2)" }}><span style={{ width: 24, display: "grid", placeItems: "center", flex: "none" }}><PIcon name="ph-gear-six" size={20} /></span><span style={{ fontSize: 14, fontWeight: 600 }}>Settings</span></button>
        </div>
      </div>

      {/* app shell (shifts right when the drawer is open) — carries the live
          aurora itself (flat --bg would paint over it and kill the liquid feel;
          it still needs an opaque-ish backdrop to cover the drawer beneath). */}
      <div className="aur" style={{ position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", transform: drawer ? "translateX(292px)" : "none", transition: "transform .3s cubic-bezier(.22,1,.36,1)", boxShadow: drawer ? "-8px 0 40px rgba(8,20,12,.2)" : "none" }}>
        {/* top bar */}
        <header style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setDrawer(true)} aria-label="Menu" style={{ width: 36, height: 36, border: "1px solid var(--line)", borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel)", color: "var(--ink-2)" }}><PIcon name="ph-list" size={17} weight="bold" /></button>
            <button onClick={nav.goMenu} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <ChatOrb size={30} />
              <div style={{ textAlign: "left" }}><div className="serif" style={{ fontSize: 18, fontWeight: 500, lineHeight: 1 }}>Vera</div><div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><span style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 500 }}>by</span><ChatMark size={11} /><span style={{ fontSize: 10, color: "var(--ink-2)", fontWeight: 600 }}>Monvera</span></div></div>
            </button>
          </div>
          <button onClick={() => nav.openCanvas("alerts")} aria-label="Notifications" style={{ width: 36, height: 36, flex: "none", border: "1px solid var(--line)", borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel)", color: "var(--ink-2)", position: "relative", marginLeft: "auto" }}>
            <PIcon name="ph-bell" size={17} />
            {unread > 0 && <span aria-hidden style={{ position: "absolute", top: 6, right: 7, width: 8, height: 8, borderRadius: "50%", background: "var(--neg)", border: "1.5px solid var(--bg)" }} />}
          </button>
          {tok && (
            <button onClick={() => nav.openCanvas("token")} className="tnum" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel)", color: "var(--ink)", fontSize: 12.5, fontWeight: 600 }}>
              <ChatMark size={14} />{priceStr(tok.priceUsd)} <span style={{ color: tok.change24h >= 0 ? "var(--pos)" : "var(--neg)" }}>{(tok.change24h >= 0 ? "▲" : "▼") + Math.abs(tok.change24h).toFixed(1) + "%"}</span>
            </button>
          )}
        </header>

        {/* home | chat */}
        {home === "menu" ? <HomeMobile nav={nav} /> : <ChatCenter nav={nav} chat={chat} narrowed={false} mobile pendingAsk={pendingAsk} consumeAsk={consumeAsk} />}

        {/* floating bottom nav (home only; chat has the composer) */}
        {home === "menu" && !canvas && (
          <div style={{ position: "absolute", left: 14, right: 14, bottom: 12, zIndex: 20, display: "grid", gridTemplateColumns: "1fr 1fr 72px 1fr 1fr", alignItems: "center", padding: "6px 8px", borderRadius: 999, background: "var(--glass)", backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)", border: "1px solid var(--line)", boxShadow: "0 18px 48px rgba(12,58,36,.22),inset 0 2px 0 rgba(255,255,255,.5)" }}>
            {navItem("ph-house", "Home", home === "menu" && !canvas, nav.goMenu)}
            {navItem("ph-squares-four", "Market", false, () => nav.openCanvas("market"))}
            <div style={{ display: "grid", placeItems: "center" }}>
              {/* Vera's orb, slowly spinning (the conic shading + highlight make the
                  rotation visible) — no label, the orb IS the brand. */}
              <button onClick={nav.goChat} aria-label="Vera" style={{ width: 56, height: 56, marginTop: -26, borderRadius: "50%", display: "grid", placeItems: "center" }}>
                <ChatOrb size={56} style={{ animation: "mvcspin 7s linear infinite", boxShadow: "0 8px 22px color-mix(in srgb,var(--primary) 45%,transparent)" }} />
              </button>
            </div>
            {navItem("ph-chart-pie-slice", "Portfolio", false, () => nav.openCanvas("portfolio"))}
            {navItem("ph-coin", "$MONVERA", false, () => nav.openCanvas("token"))}
          </div>
        )}

        {/* dim scrim — INSIDE the shell so it shifts away with it, leaving the
            revealed drawer fully clickable (tapping the dimmed shell closes it).
            Always mounted: its opacity fades in step with the shell slide instead
            of popping (interruptible CSS transition). */}
        <div onClick={() => setDrawer(false)} style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(8,14,10,.35)", opacity: drawer ? 1 : 0, pointerEvents: drawer ? "auto" : "none", transition: "opacity .3s cubic-bezier(.22,1,.36,1)" }} />
      </div>

      {/* full-screen Groves page — below the canvas sheet, so a holding tapped
          inside a composition opens on top and closes back to the Grove */}
      {grovesView && (
        <div className={grovesClosing ? "sheet sheet-out aur" : "sheet aur"} style={{ position: "absolute", inset: 0, zIndex: 60, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
          <GrovesPage mobile groveId={grovesView.id} autoManage={grovesView.auto} nav={nav} onOpen={(id) => setGrovesView({ id, auto: false })} onBack={() => (grovesView.id ? setGrovesView({ id: null, auto: false }) : closeGroves())} />
        </div>
      )}

      {/* full-screen canvas sheet */}
      {canvas && meta && (
        <div className={sheetClosing ? "sheet sheet-out aur" : "sheet aur"} style={{ position: "absolute", inset: 0, zIndex: 80, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
            <button onClick={nav.closeCanvas} aria-label="Back" style={{ width: 36, height: 36, flex: "none", border: "1px solid var(--line)", borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel)", color: "var(--ink-2)" }}><PIcon name="ph-caret-left" size={16} weight="bold" /></button>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{canvasTitle}</div><div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{canvasSub}</div></div>
          </div>
          <div className="scr stag" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
            <CanvasBody type={canvas} symbol={canvasSymbol} nav={nav} />
          </div>
        </div>
      )}

      {/* overlays (reused desktop components; centered — fill the phone width) */}
      {order && (order.symbol === "MONVERA"
        ? <TokenOrderTicket order={order} onClose={() => setOrder(null)} nav={nav} />
        : <OrderTicket order={order} onClose={() => setOrder(null)} nav={nav} />)}
      {payMode && <PaySheet mode={payMode} onClose={() => setPayMode(null)} />}
      {settingsOpen && <SettingsPopup onClose={() => setSettingsOpen(false)} nav={nav} />}
      {historyOpen && <HistoryPopup chat={chat} onPick={(id) => { chat.setActiveId(id); setHome("chat"); setDrawer(false); }} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
