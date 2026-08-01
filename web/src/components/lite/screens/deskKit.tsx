"use client";

// Shared kit for the desktop-native shell (≥1024px), ported from the Monvera
// Desktop design. Pure presentational helpers + tiny SVG chart builders, themed
// entirely through the app's CSS vars (--primary / --surface / --pos / --ink…),
// so light/dark and the six accent palettes all flow through automatically.
import type { CSSProperties, ReactNode } from "react";
import {
  House, LayoutGrid, PieChart, Orbit, Wallet, Camera, Coins, SlidersHorizontal,
  History, Settings, ChevronLeft, ChevronRight, Sparkles, Search, Bell, Eye, EyeOff,
  Moon, Sun, Star, TrendingUp, ShieldCheck, ArrowUpRight, ArrowDownRight, Send,
  type LucideIcon,
} from "lucide-react";

// ── icon map: design uses Phosphor names; we render lucide (already a dep) ──
const ICONS: Record<string, LucideIcon> = {
  house: House, grid: LayoutGrid, pie: PieChart, planet: Orbit, wallet: Wallet,
  camera: Camera, coin: Coins, sliders: SlidersHorizontal, clock: History,
  gear: Settings, caretL: ChevronLeft, caretR: ChevronRight, sparkle: Sparkles,
  search: Search, bell: Bell, eye: Eye, eyeOff: EyeOff, moon: Moon, sun: Sun,
  star: Star, trend: TrendingUp, shield: ShieldCheck, up: ArrowUpRight,
  down: ArrowDownRight, send: Send,
};

export function DIcon({ name, size = 20, stroke = 2, style, className }: { name: keyof typeof ICONS | string; size?: number; stroke?: number; style?: CSSProperties; className?: string }) {
  const C = ICONS[name] ?? House;
  return <C size={size} strokeWidth={stroke} style={style} className={className} absoluteStrokeWidth />;
}

// ── formatters ──
export const usd = (n: number) => "$" + (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd0 = (n: number) => "$" + Math.round(isFinite(n) ? n : 0).toLocaleString("en-US");
export const signUsd = (n: number) => (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pctStr = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
export const priceStr = (n: number) => (n < 0.01 ? "$" + Number(n.toPrecision(3)) : "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 2 }));
export const dcol = (day: number, coming?: boolean) => (coming ? "var(--ink-3)" : day >= 0 ? "var(--pos)" : "var(--neg)");

// ── SVG path builders (smoothed line + area, and flat sparkline) ──
function pts(series: number[], w: number, h: number, pad = 8): [number, number][] {
  const mx = Math.max(...series), mn = Math.min(...series), sp = mx - mn || 1;
  return series.map((v, i) => [(i / (series.length - 1)) * w, pad + (h - pad * 2) - ((v - mn) / sp) * (h - pad * 2)]);
}
function smooth(p: [number, number][]): string {
  if (p.length < 2) return "";
  const d = ["M " + p[0][0].toFixed(2) + " " + p[0][1].toFixed(2)];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push("C " + c1x.toFixed(2) + " " + c1y.toFixed(2) + ", " + c2x.toFixed(2) + " " + c2y.toFixed(2) + ", " + p2[0].toFixed(2) + " " + p2[1].toFixed(2));
  }
  return d.join(" ");
}
export function chartPaths(series: number[], w = 660, h = 150): { line: string; area: string } {
  const p = pts(series, w, h);
  const line = smooth(p);
  return { line, area: line + " L " + w + " " + h + " L 0 " + h + " Z" };
}
export function sparkPath(series: number[], w = 74, h = 26): string {
  const mx = Math.max(...series), mn = Math.min(...series), sp = mx - mn || 1;
  return series.map((v, i) => (i ? "L" : "M") + ((i / (series.length - 1)) * w).toFixed(1) + " " + (h - ((v - mn) / sp) * (h - 4) - 2).toFixed(1)).join(" ");
}
// Deterministic synthetic curve (matches the design's value-chart shape when no
// real portfolio-history series exists). Seeded by range so tabs feel distinct.
export function curve(seed: number, n: number, drift: number, amp: number): number[] {
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) { v += drift + Math.sin(i * seed) * amp + Math.cos(i * seed * 0.6) * amp * 0.7; out.push(v); }
  return out;
}
export const RANGE_DEFS: Record<string, [number, number, number, number]> = {
  "1D": [1.1, 26, 0.04, 0.5], "1W": [0.7, 30, 0.05, 0.7], "1M": [0.5, 30, 0.08, 1],
  "3M": [0.4, 40, 0.12, 1.4], "1Y": [0.3, 48, 0.16, 1.8], All: [0.22, 56, 0.22, 2.2],
};

// ── value / detail area chart (gradient fill, faint gridlines, end dot) ──
export function AreaChart({ series, up, height = 150, uid = "a" }: { series: number[]; up: boolean; height?: number; uid?: string }) {
  const w = 660;
  const { line, area } = chartPaths(series, w, height);
  const p = pts(series, w, height);
  const last = p[p.length - 1];
  const color = up ? "var(--pos)" : "var(--neg)";
  const id = "mvg" + uid;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((gy) => (
        <line key={gy} x1={0} y1={(height * gy) / 100} x2={w} y2={(height * gy) / 100} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.5} />
      ))}
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// small inline sparkline (holdings table / market rows)
export function Spark({ series, color, w = 74, h = 26 }: { series: number[]; color: string; w?: number; h?: number }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <path d={sparkPath(series, w, h)} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── allocation donut (conic gradient ring + count in the hole) ──
export interface DonutSeg { name: string; wpct: number }
export function Donut({ segs, count, size = 104 }: { segs: DonutSeg[]; count: number; size?: number }) {
  let acc = 0;
  const stops: string[] = [];
  const legend: { name: string; color: string; weight: string }[] = [];
  segs.forEach((s, i) => {
    const col = `color-mix(in srgb, var(--primary) ${Math.max(26, 92 - i * 15)}%, var(--surface-2))`;
    stops.push(`${col} ${acc.toFixed(1)}% ${(acc + s.wpct).toFixed(1)}%`);
    legend.push({ name: s.name, color: col, weight: Math.round(s.wpct) + "%" });
    acc += s.wpct;
  });
  const grad = segs.length ? `conic-gradient(${stops.join(",")})` : "var(--surface-2)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: grad }} />
        <div style={{ position: "absolute", inset: 15, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>{count}</div>
            <div style={{ fontSize: 9.5, color: "var(--ink-3)" }}>holdings</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {legend.map((l) => (
          <div key={l.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: l.color }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-2)" }}>{l.name}</span>
            <span className="tnum" style={{ fontWeight: 600 }}>{l.weight}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── shared surface primitives (design's card grammar) ──
export const cardStyle: CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg, 22px)", boxShadow: "var(--shadow)" };

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...cardStyle, ...style }}>{children}</div>;
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{title}</h2>
      {action}
    </div>
  );
}

export function ViewAll({ onClick, label = "View all" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--primary)", fontFamily: "inherit" }}>
      {label} <DIcon name="caretR" size={12} stroke={2.4} />
    </button>
  );
}

// The reusable colored glyph tile used across rows (asset badge).
export function Glyph({ text, color, size = 32, radius = 9, fontSize = 12.5 }: { text: string; color: string; size?: number; radius?: number; fontSize?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: radius, flex: "none", display: "grid", placeItems: "center", fontSize, fontWeight: 700, color: "#fff", background: color }}>
      {text}
    </span>
  );
}
