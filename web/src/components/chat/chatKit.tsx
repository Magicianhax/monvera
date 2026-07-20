"use client";

// Shared kit for the chat-first Monvera UI (the "Monvera Chat" design).
// Scope class: .mvc (desktop) / .mvm (mobile) — BOTH get the same token set via
// CHAT_THEME_CSS. Light/dark via data-mode on the scope element. The design's
// glass "panel" look keys off inline `background:var(--panel);` (the CSS
// attribute selector adds the inset highlights), so panels MUST be written as
// style={{ background: "var(--panel)", ... }} — keep that idiom.
import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  House, ChatsCircle, PlusCircle, List, Camera, Coins, SlidersHorizontal,
  Lightbulb, ChartPieSlice, SquaresFour, Wallet, SealCheck, GearSix, Moon, Sun, X,
  MagnifyingGlass, ArrowUp, PaperPlaneTilt, QrCode, Sparkle, CheckCircle, Check,
  TrendUp, ShieldCheck, Plus, Minus, CircleNotch, LockKey, Lock, Signature,
  ArrowUpRight, ArrowDownRight, ArrowSquareOut, CaretLeft, CaretRight, Scales,
  PiggyBank, Repeat, HandTap, UsersThree, AirplaneTilt, ChartLineUp, ClockCounterClockwise,
  SignOut, GoogleLogo, XLogo, Bell, Star,
  CornersOut, CornersIn, HandCoins, ListChecks, Scissors, ArrowsOut, Eye, EyeSlash,
  UploadSimple, Copy, ArrowsCounterClockwise, LockSimple, Lightning, CaretDown,
  ArrowRight, Info, Shield, Clock,
  type Icon as PhosphorIcon,
  Tree,
} from "@phosphor-icons/react";

// ── icon map (the design names Phosphor icons; we ship @phosphor-icons/react) ──
const ICONS: Record<string, PhosphorIcon> = {
  "ph-corners-out": CornersOut, "ph-corners-in": CornersIn, "ph-hand-coins": HandCoins,
  "ph-list-checks": ListChecks, "ph-scissors": Scissors, "ph-arrows-out": ArrowsOut,
  "ph-eye": Eye, "ph-eye-slash": EyeSlash, "ph-upload-simple": UploadSimple, "ph-copy": Copy,
  "ph-arrows-counter-clockwise": ArrowsCounterClockwise, "ph-lock-simple": LockSimple,
  "ph-lightning": Lightning, "ph-caret-down": CaretDown, "ph-arrow-right": ArrowRight,
  "ph-info": Info, "ph-shield": Shield, "ph-clock": Clock,
  "ph-house": House, "ph-chats-circle": ChatsCircle, "ph-plus-circle": PlusCircle, "ph-list": List,
  "ph-camera": Camera, "ph-coin": Coins, "ph-sliders-horizontal": SlidersHorizontal, "ph-clock-counter-clockwise": ClockCounterClockwise,
  "ph-lightbulb": Lightbulb, "ph-chart-pie-slice": ChartPieSlice, "ph-squares-four": SquaresFour, "ph-wallet": Wallet,
  "ph-seal-check": SealCheck, "ph-gear-six": GearSix, "ph-moon": Moon, "ph-sun": Sun, "ph-x": X,
  "ph-magnifying-glass": MagnifyingGlass, "ph-arrow-up": ArrowUp, "ph-paper-plane-tilt": PaperPlaneTilt,
  "ph-qr-code": QrCode, "ph-sparkle": Sparkle, "ph-check-circle": CheckCircle, "ph-check": Check,
  "ph-trend-up": TrendUp, "ph-shield-check": ShieldCheck, "ph-plus": Plus, "ph-minus": Minus,
  "ph-circle-notch": CircleNotch, "ph-lock-key": LockKey, "ph-lock": Lock, "ph-signature": Signature,
  "ph-arrow-up-right": ArrowUpRight, "ph-arrow-down-right": ArrowDownRight, "ph-arrow-square-out": ArrowSquareOut,
  "ph-caret-left": CaretLeft, "ph-caret-right": CaretRight, "ph-scales": Scales, "ph-piggy-bank": PiggyBank,
  "ph-repeat": Repeat, "ph-hand-tap": HandTap, "ph-users-three": UsersThree, "ph-airplane-tilt": AirplaneTilt,
  "ph-chart-line-up": ChartLineUp, "ph-sign-out": SignOut, "ph-tree": Tree,
  "ph-google-logo": GoogleLogo, "ph-x-logo": XLogo, "ph-bell": Bell, "ph-star": Star,
};

export function PIcon({ name, size = 18, weight = "duotone", style }: { name: string; size?: number; weight?: "duotone" | "fill" | "bold" | "regular"; style?: CSSProperties }) {
  const C = ICONS[name] ?? Sparkle;
  return <C size={size} weight={weight === "bold" ? "bold" : weight} style={{ display: "block", ...style }} />;
}

// ── formatters (design's exact display rules) ──
export const usd = (n: number) => "$" + (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function relDay(unix: number): string {
  const d = Math.max(0, Date.now() / 1000 - unix);
  if (d < 3600) return "Just now";
  if (d < 86400) return "Today";
  if (d < 2 * 86400) return "Yesterday";
  if (d < 7 * 86400) return Math.round(d / 86400) + " days ago";
  return Math.round(d / (7 * 86400)) + " week" + (d >= 14 * 86400 ? "s" : "") + " ago";
}
export const usd0 = (n: number) => "$" + Math.round(isFinite(n) ? n : 0).toLocaleString("en-US");
export const pctStr = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
export const priceStr = (n: number) => (n < 0.01 ? "$" + Number(n.toPrecision(3)) : "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 2 }));
export const dcol = (d: number) => (d >= 0 ? "var(--pos)" : "var(--neg)");

// ── SVG chart path builders (verbatim from the design's math) ──
function smooth(p: [number, number][]): string {
  if (p.length < 2) return "";
  const d = ["M " + p[0][0].toFixed(2) + " " + p[0][1].toFixed(2)];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    d.push("C " + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + " " + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(2) + ", " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + " " + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(2) + ", " + p2[0].toFixed(2) + " " + p2[1].toFixed(2));
  }
  return d.join(" ");
}
export function chartPaths(series: number[], w: number, h: number): { line: string; area: string } {
  const pad = 6, mx = Math.max(...series), mn = Math.min(...series), sp = mx - mn || 1;
  const pts: [number, number][] = series.map((v, i) => [(i / (series.length - 1)) * w, pad + (h - pad * 2) - ((v - mn) / sp) * (h - pad * 2)]);
  const line = smooth(pts);
  return { line, area: line + " L " + w + " " + h + " L 0 " + h + " Z" };
}
export function sparkPath(series: number[], w = 74, h = 26): string {
  const mx = Math.max(...series), mn = Math.min(...series), sp = mx - mn || 1;
  return series.map((v, i) => (i ? "L" : "M") + ((i / (series.length - 1)) * w).toFixed(1) + " " + (h - ((v - mn) / sp) * (h - 4) - 2).toFixed(1)).join(" ");
}
export function curve(seed: number, n: number, drift: number, amp: number): number[] {
  const o: number[] = []; let v = 100;
  for (let i = 0; i < n; i++) { v += drift + Math.sin(i * seed) * amp + Math.cos(i * seed * 0.6) * amp * 0.7; o.push(v); }
  return o;
}

/** Crosshair + price readout over a chart drawn with chartPaths(series, w, vh).
 *  Wrap the <svg>; pass the SAME series + viewBox height. Real series only —
 *  never hand it a synthetic curve (no fake prices). */
export function ChartHover({ series, vh, fmt, color = "var(--primary)", children }: { series: number[] | null; vh: number; fmt: (v: number) => string; color?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const move = (e: React.PointerEvent) => {
    if (!series || series.length < 2) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setIdx(Math.round(f * (series.length - 1)));
  };
  let overlay: ReactNode = null;
  if (idx !== null && series && series.length > 1) {
    const mn = Math.min(...series), mx = Math.max(...series), sp = mx - mn || 1;
    const i = Math.min(idx, series.length - 1);
    const v = series[i];
    const xPct = (i / (series.length - 1)) * 100;
    // mirror chartPaths' 6px vertical padding in viewBox units
    const yPct = ((6 + (vh - 12) * (1 - (v - mn) / sp)) / vh) * 100;
    const onRight = xPct > 55;
    overlay = (
      <>
        <span aria-hidden style={{ position: "absolute", left: xPct + "%", top: 0, bottom: 0, width: 1, background: "var(--ink-3)", opacity: 0.5, pointerEvents: "none" }} />
        <span aria-hidden style={{ position: "absolute", left: xPct + "%", top: yPct + "%", width: 9, height: 9, borderRadius: "50%", background: "var(--bg)", border: `2px solid ${color}`, transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
        <span className="tnum" style={{ position: "absolute", top: 2, left: onRight ? undefined : `calc(${xPct}% + 9px)`, right: onRight ? `calc(${100 - xPct}% + 9px)` : undefined, padding: "3px 9px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, background: "var(--glass)", border: "1px solid var(--line)", color: "var(--ink)", pointerEvents: "none", whiteSpace: "nowrap" }}>{fmt(v)}</span>
      </>
    );
  }
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={() => setIdx(null)} style={{ position: "relative", width: "100%", touchAction: "pan-y" }}>
      {children}
      {overlay}
    </div>
  );
}

/** Vera's orb — the conic-gradient sphere used across the design. */
export function ChatOrb({ size = 30, pulse = false, style }: { size?: number; pulse?: boolean; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, flex: "none", borderRadius: "50%", display: "block",
        background: "radial-gradient(circle at 32% 28%, #fff, transparent 32%), conic-gradient(from 200deg, var(--primary), var(--primary-2), var(--primary))",
        boxShadow: `0 3px 9px color-mix(in srgb, var(--primary) 28%, transparent)`,
        animation: pulse ? "mvcpulse 3.6s ease-in-out infinite" : undefined,
        ...style,
      }}
    />
  );
}

/** The Monvera leaf mark tinted via CSS mask (design's assets/monvera-mark-white.png). */
export function ChatMark({ size = 14, color = "var(--primary)" }: { size?: number; color?: string }) {
  return <span aria-hidden style={{ width: size, height: size, flex: "none", display: "inline-block", WebkitMask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", mask: "url(/brand/monvera-icon-white.png) center/contain no-repeat", background: color }} />;
}

// Shared panel idiom — background MUST be exactly "var(--panel)" for the glass
// highlight selector to bite (see CHAT_THEME_CSS).
export const panel = (extra?: CSSProperties): CSSProperties => ({ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, ...extra });

export function GlyphTile({ text, color, size = 34, radius = 10, fontSize = 13 }: { text: string; color: string; size?: number; radius?: number; fontSize?: number }) {
  return <span style={{ width: size, height: size, borderRadius: radius, flex: "none", display: "grid", placeItems: "center", fontSize, fontWeight: 700, color: "#fff", background: color }}>{text}</span>;
}

export type CanvasType = "market" | "holding" | "portfolio" | "vera" | "wallet" | "token" | "autopilot" | "scan" | "activity" | "insights" | "alerts";

/** Canvas chrome metadata (title/sub/icon) — from the design's CTITLE/CSUB/CICON. */
export const CANVAS_META: Record<CanvasType, { title: string; sub: string; icon: string }> = {
  market: { title: "Market", sub: "Browse & buy the universe", icon: "ph-squares-four" },
  holding: { title: "", sub: "", icon: "ph-chart-line-up" }, // title/sub filled from the symbol
  portfolio: { title: "Portfolio", sub: "What you own", icon: "ph-chart-pie-slice" },
  vera: { title: "Track record", sub: "On-chain track record", icon: "ph-sparkle" },
  wallet: { title: "Wallet", sub: "Cash & self-custody", icon: "ph-wallet" },
  token: { title: "$MONVERA", sub: "Project token", icon: "ph-coin" },
  autopilot: { title: "Autopilot", sub: "Recurring investing", icon: "ph-sliders-horizontal" },
  scan: { title: "Scan to Buy", sub: "Feature preview", icon: "ph-camera" },
  activity: { title: "Activity", sub: "Full history", icon: "ph-clock-counter-clockwise" },
  insights: { title: "Insights", sub: "What Vera notices", icon: "ph-lightbulb" },
  alerts: { title: "Notifications", sub: "Inbox & price alerts", icon: "ph-bell" },
};

// ── the theme: tokens, liquid aurora, glass highlights, animations ──
// Ported verbatim from the design's <style> block; scoped to .mvc AND .mvm.
export const CHAT_THEME_CSS = `
.mvc i[class*="ph-"],.mvm i[class*="ph-"]{line-height:1;display:block}
.mvc button,.mvm button{color:var(--ink);border:none;background:none;cursor:pointer;font-family:inherit;padding:0}
@keyframes mvliquid{0%,100%{background-position:0% 0%,100% 0%,70% 50%,30% 100%,0 0}50%{background-position:18% 8%,82% 16%,58% 38%,44% 88%,0 0}}
.mvc[data-mode],.mvm[data-mode]{background-size:170% 170%,170% 170%,170% 170%,170% 170%,100% 100%!important;animation:mvliquid 26s ease-in-out infinite}
.mvc [style*="var(--panel);"],.mvm [style*="var(--panel);"]{backdrop-filter:blur(26px) saturate(190%);-webkit-backdrop-filter:blur(26px) saturate(190%);box-shadow:inset 0 2px 0 rgba(255,255,255,.95),inset 1.5px 0 0 rgba(255,255,255,.45),inset 0 -1.5px 0 rgba(255,255,255,.22),0 24px 60px rgba(12,58,36,.17),0 2px 8px rgba(12,58,36,.06)}
.mvc[data-mode="dark"] [style*="var(--panel);"],.mvm[data-mode="dark"] [style*="var(--panel);"]{box-shadow:inset 0 2px 0 rgba(255,255,255,.28),inset 1.5px 0 0 rgba(255,255,255,.1),inset 0 -1.5px 0 rgba(255,255,255,.05),0 24px 60px rgba(0,0,0,.52),0 2px 8px rgba(0,0,0,.3)}
@media (prefers-contrast:more){.mvc [style*="var(--panel);"],.mvm [style*="var(--panel);"]{background:var(--bg)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;border-color:var(--ink-3)!important}}
.mvc ::-webkit-scrollbar{width:8px}
.mvc ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ink-3) 34%,transparent);border-radius:99px}
.mvm ::-webkit-scrollbar{display:none}
.mvc input::placeholder,.mvc textarea::placeholder,.mvm input::placeholder,.mvm textarea::placeholder{color:var(--ink-3)}
.mvc ::selection,.mvm ::selection{background:color-mix(in srgb,var(--primary) 26%,transparent)}
.mvc .nosb::-webkit-scrollbar,.mvm .nosb::-webkit-scrollbar{display:none}
.mvc,.mvm{
  --font-display:var(--font-fraunces),'Fraunces',Georgia,serif;--font-ui:var(--font-roboto),'Roboto Flex',system-ui,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,monospace;
  --primary:#12a05e;--primary-2:#1cb672;--primary-soft:#e4f4ea;--primary-ink:#fff;
  --pos:#12a05e;--neg:#d9544a;
  --bg:#f2f7f2;--panel:linear-gradient(118deg,rgba(255,255,255,.5) 0%,rgba(255,255,255,.1) 26%,rgba(255,255,255,0) 42%),linear-gradient(155deg,rgba(255,255,255,.34),rgba(255,255,255,.12) 55%,rgba(255,255,255,.26));--panel-2:rgba(255,255,255,.32);--line:rgba(255,255,255,.8);--line-2:rgba(30,60,42,.06);
  --ink:#141a16;--ink-2:#4d564f;--ink-3:#98a09a;--glass:linear-gradient(155deg,rgba(255,255,255,.72),rgba(255,255,255,.5));--hglh:rgba(255,255,255,.5);
}
.mvc[data-mode="dark"],.mvm[data-mode="dark"]{
  --primary:#34d391;--primary-2:#4ce3a4;--primary-soft:#123227;--primary-ink:#04120b;
  --pos:#34d391;--neg:#ff6f5e;
  --bg:#0d1411;--panel:linear-gradient(118deg,rgba(255,255,255,.11) 0%,rgba(255,255,255,.025) 26%,rgba(255,255,255,0) 42%),linear-gradient(155deg,rgba(40,56,47,.32),rgba(14,22,18,.16) 55%,rgba(26,38,31,.28));--panel-2:rgba(255,255,255,.065);--line:rgba(255,255,255,.2);--line-2:rgba(255,255,255,.07);
  --ink:#f2f7f4;--ink-2:#b7c2bc;--ink-3:#71807a;--glass:linear-gradient(155deg,rgba(30,42,36,.76),rgba(16,24,20,.6));--hglh:rgba(255,255,255,.12);
}
.mvc[data-mode="light"],.mvm[data-mode="light"],.mvc[data-mode="light"] .aur,.mvm[data-mode="light"] .aur{background:radial-gradient(52% 40% at 4% 0%,color-mix(in srgb,var(--primary) 38%,transparent),transparent 62%),radial-gradient(46% 34% at 100% 6%,color-mix(in srgb,var(--primary-2) 32%,transparent),transparent 60%),radial-gradient(40% 30% at 78% 48%,color-mix(in srgb,var(--primary-2) 26%,transparent),transparent 62%),radial-gradient(70% 44% at 34% 112%,color-mix(in srgb,var(--primary) 30%,transparent),transparent 66%),linear-gradient(165deg,color-mix(in srgb,var(--primary) 7%,#fcfdfc),color-mix(in srgb,var(--primary) 11%,#eef0ee))!important}
.mvc[data-mode="dark"],.mvm[data-mode="dark"],.mvc[data-mode="dark"] .aur,.mvm[data-mode="dark"] .aur{background:radial-gradient(52% 40% at 4% 0%,color-mix(in srgb,var(--primary) 46%,transparent),transparent 62%),radial-gradient(46% 34% at 100% 6%,color-mix(in srgb,var(--primary-2) 36%,transparent),transparent 60%),radial-gradient(40% 30% at 78% 48%,color-mix(in srgb,var(--primary-2) 24%,transparent),transparent 62%),radial-gradient(70% 44% at 34% 112%,color-mix(in srgb,var(--primary) 34%,transparent),transparent 66%),linear-gradient(165deg,color-mix(in srgb,var(--primary) 9%,#0b0f0c),color-mix(in srgb,var(--primary) 5%,#070a08))!important}
.mvc .aur,.mvm .aur{background-size:170% 170%,170% 170%,170% 170%,170% 170%,100% 100%!important;animation:mvliquid 26s ease-in-out infinite}
.mvc .serif,.mvm .serif{font-family:var(--font-display);letter-spacing:-.022em}
.mvc .tnum,.mvm .tnum{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.mvc .mono,.mvm .mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
@keyframes mvcrise{from{opacity:.001;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes mvcslide{from{opacity:.001;transform:translateX(24px)}to{opacity:1;transform:none}}
@keyframes mvcup{from{opacity:.001;transform:translateY(100%)}to{opacity:1;transform:none}}
@keyframes mvcpulse{0%,100%{transform:scale(.95)}50%{transform:scale(1.05)}}
@keyframes mvcspin{to{transform:rotate(360deg)}}
.mvc .msg,.mvm .msg{animation:mvcrise .38s cubic-bezier(.23,1,.32,1) both}
.mvc .canv{animation:mvcslide .3s cubic-bezier(.22,1,.36,1) both}
.mvm .sheet{animation:mvcup .32s cubic-bezier(.22,1,.36,1) both}
/* exits mirror entrances (same path back, slightly faster) */
@keyframes mvcslideout{from{opacity:1;transform:none}to{opacity:.001;transform:translateX(24px)}}
.mvc .canv-out{animation:mvcslideout .21s cubic-bezier(.23,1,.32,1) both}
@keyframes mvcupout{from{opacity:1;transform:none}to{opacity:1;transform:translateY(100%)}}
.mvm .sheet-out{animation:mvcupout .26s cubic-bezier(.23,1,.32,1) both}
.mvc button{transition:transform .12s ease-out,filter .18s ease-out,background .18s ease-out;will-change:transform}
.mvc button:active,.mvm button:active{transform:scale(.965);filter:brightness(1.07)}
.mvc .hgl{transition:background .15s ease-out}
/* glass light-reflection: a sheen sweeps across ANY hovered button (pointer only).
   Rest state has no transition, so it resets instantly and replays each hover. */
.mvc button{position:relative}
.mvc button::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(105deg,transparent 44%,rgba(255,255,255,.25) 50%,transparent 56%) no-repeat 230% 0/220% 100%}
.mvc button:disabled::before{display:none}
@media (hover:hover) and (pointer:fine){
  .mvc button:hover{filter:brightness(1.04)}
  .mvc button:hover::before{background-position:-130% 0;transition:background-position 1.6s cubic-bezier(.35,.55,.35,1)}
  /* !important: hgl elements often carry inline background:transparent, which
     would otherwise beat this rule — the hover surround must always show */
  .mvc .hgl:hover{background:var(--hglh)!important;box-shadow:inset 0 0 0 1px var(--line)}
}
.mvc .glassin,.mvm .glassin{animation:mvmat .34s cubic-bezier(.25,1,.25,1) both}
@keyframes mvmat{from{opacity:.001;transform:scale(.94);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
/* moment animations — plan landing (allocation bar wipes in) & invest success (check settles in) */
@keyframes mvcwipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.mvc .wipe,.mvm .wipe{animation:mvcwipe .7s cubic-bezier(.23,1,.32,1) .15s both}
@keyframes mvcpop{from{opacity:0;transform:scale(.5)}60%{opacity:1;transform:scale(1.06)}to{opacity:1;transform:none}}
.mvc .pop,.mvm .pop{animation:mvcpop .45s cubic-bezier(.23,1,.32,1) .1s both}
/* overlay scrims fade in with their materializing panel instead of popping */
@keyframes mvcfade{from{opacity:.001}to{opacity:1}}
.mvc .fadein,.mvm .fadein{animation:mvcfade .25s ease-out both}
/* overlay exits mirror the entrance (de-materialize + scrim fade, faster) */
@keyframes mvcfadeout{from{opacity:1}to{opacity:.001}}
.mvc .fadeout,.mvm .fadeout{animation:mvcfadeout .2s ease-out both}
@keyframes mvmatout{from{opacity:1;transform:none;filter:none}to{opacity:.001;transform:scale(.94);filter:blur(6px)}}
.mvc .glassout,.mvm .glassout{animation:mvmatout .2s cubic-bezier(.23,1,.32,1) both}
/* ── phone: every centered overlay becomes an iOS bottom sheet ──
   The scrim keeps its fade; the PANEL docks to the bottom edge, spans the
   width, squares its bottom corners, and slides up/down instead of
   materializing in place (same paths in and out — spatial consistency). */
.mvm .fadein{place-items:end stretch!important;padding:0!important}
.mvm .fadein>.glassin,.mvm .fadein>.glassout{max-width:100%!important;width:100%!important;border-radius:22px 22px 0 0!important;border-left:none!important;border-right:none!important;border-bottom:none!important;padding-bottom:env(safe-area-inset-bottom)}
.mvm .fadein>.glassin{animation:mvcup .34s cubic-bezier(.22,1,.36,1) both}
.mvm .fadein>.glassout{animation:mvcupout .26s cubic-bezier(.23,1,.32,1) both}
/* canvas content staggers in with the panel — quick (≤190ms of total delay),
   decorative, never blocks interaction */
.mvc .stag>*>*,.mvm .stag>*>*{animation:mvcrise .32s cubic-bezier(.23,1,.32,1) both}
.mvc .stag>*>*:nth-child(2),.mvm .stag>*>*:nth-child(2){animation-delay:.04s}
.mvc .stag>*>*:nth-child(3),.mvm .stag>*>*:nth-child(3){animation-delay:.08s}
.mvc .stag>*>*:nth-child(4),.mvm .stag>*>*:nth-child(4){animation-delay:.12s}
.mvc .stag>*>*:nth-child(5),.mvm .stag>*>*:nth-child(5){animation-delay:.15s}
.mvc .stag>*>*:nth-child(n+6),.mvm .stag>*>*:nth-child(n+6){animation-delay:.19s}
@media (prefers-reduced-transparency:reduce){.mvc [style*="var(--panel);"],.mvm [style*="var(--panel);"]{background:var(--bg)!important;backdrop-filter:none!important}}
@media (prefers-reduced-motion:reduce){.mvc *,.mvm *{animation:none!important}.mvc button{transition:none}}
`;

// ── color styles: the classic app's 6 palettes, applied to the chat scope ──
// Emerald = the tuned defaults baked into CHAT_THEME_CSS above; every other
// palette overrides the brand vars per mode. The aurora is color-mix'd off
// --primary, so switching the palette recolors the whole liquid.
import { COLOR_STYLES } from "@/lib/colorStyles";
export const CHAT_STYLE_CSS = COLOR_STYLES.filter((s) => s.key !== "emerald")
  .map(
    (s) =>
      `.mvc[data-style="${s.key}"],.mvm[data-style="${s.key}"]{--primary:${s.light.primary};--primary-2:color-mix(in srgb,${s.light.primary} 68%,#fff);--primary-soft:${s.light.primarySoft};--primary-ink:${s.light.primaryInk}}` +
      `.mvc[data-style="${s.key}"][data-mode="dark"],.mvm[data-style="${s.key}"][data-mode="dark"]{--primary:${s.dark.primary};--primary-2:color-mix(in srgb,${s.dark.primary} 68%,#fff);--primary-soft:${s.dark.primarySoft};--primary-ink:${s.dark.primaryInk}}`,
  )
  .join("\n");

export interface ChatNav {
  openCanvas: (type: CanvasType, symbol?: string) => void;
  closeCanvas: () => void;
  goChat: () => void;
  goMenu: () => void;
  openBuy: (symbol: string) => void;
  openSell: (symbol: string) => void;
  /** Feed a goal/instruction straight into the Vera conversation. */
  askVera: (text: string) => void;
  /** Open the in-app Groves surface — the shelf, or one Grove's full page.
   *  `auto` lands on the (gated) auto-manage section of the detail page. */
  openGroves: (id?: string, opts?: { auto?: boolean }) => void;
  openSend: () => void;
  openReceive: () => void;
  openSettings: () => void;
}

export type { CSSProperties, ReactNode };
