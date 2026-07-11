"use client";

// Stax data-viz primitives — ported from the design handoff (components.jsx).
// Sparkline, RiskMeter, Donut, CountUp. Presentational + reusable.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  /** Thicker stroke + filled area gradient. */
  strong?: boolean;
}

export function Sparkline({
  data,
  w = 64,
  h = 24,
  color = "var(--pos)",
  strong = false,
}: SparklineProps) {
  const id = useId().replace(/:/g, "");
  if (!data.length) return <svg width={w} height={h} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - ((v - min) / span) * (h - 3) - 1.5;
    return [x, y] as const;
  });
  const d = pts
    .map((point, i) => (i ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1))
    .join(" ");
  const area = d + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={strong ? 0.22 : 0.14} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {strong && <path d={area} fill={`url(#sp${id})`} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strong ? 2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Big price chart ──────────────────────────────────────────────────────────
// A full-width area chart for the asset detail + trade screens. Smooth Catmull-Rom
// curve, gradient area fill, faint gridlines, and a glowing end dot. The coarse
// reference spark is densified deterministically so it reads like a real price line.

// Catmull-Rom → cubic bezier for a smooth line through the points.
function smoothPath(p: readonly (readonly [number, number])[]): string {
  if (p.length < 2) return "";
  const d = [`M ${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`,
    );
  }
  return d.join(" ");
}

// Interpolate between coarse points + add a small deterministic wobble so the
// line looks like real intraday movement (no Math.random — stable across renders).
function densify(src: number[], steps = 6): number[] {
  if (src.length < 2) return src;
  const out: number[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const e = t * t * (3 - 2 * t); // smoothstep
      const wob = Math.sin((i * steps + s) * 1.7) * (Math.abs(b - a) * 0.14 + 0.05);
      out.push(a + (b - a) * e + wob);
    }
  }
  out.push(src[src.length - 1]);
  return out;
}

export interface PriceChartProps {
  data: number[];
  /** Up = positive (green) / down = negative (red) coloring. */
  up?: boolean;
  /** Pixel height. */
  height?: number;
  /** Screen-reader description of the trend (charts are otherwise invisible to SR). */
  label?: string;
  /** Fires while the user scrubs the chart; null when they lift off. `index` is
   *  into the original `data` array so the parent can read the real price/time. */
  onScrub?: (p: { price: number; index: number } | null) => void;
  /** Skip the synthetic intraday jitter — pass a real, already-dense value series
   *  as-is (the jitter's absolute magnitude is wrong for small-dollar curves). */
  raw?: boolean;
}

const PAD = 7; // vertical inset (viewBox %) so the line never touches the edges

export function PriceChart({ data, up = true, height = 210, label, onScrub, raw = false }: PriceChartProps) {
  const id = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  // xPct/yPct in [0,100]; price = the real interpolated value at the cursor.
  const [cursor, setCursor] = useState<{ xPct: number; yPct: number; price: number } | null>(null);

  const series = raw ? data : densify(data, 6);
  const min = series.length ? Math.min(...series) : 0;
  const max = series.length ? Math.max(...series) : 1;
  const span = max - min || 1;
  const yOf = (v: number) => 100 - PAD - ((v - min) / span) * (100 - PAD * 2);

  // Map a horizontal fraction to the real (un-densified) price at that point.
  function pointAt(fraction: number): { xPct: number; yPct: number; price: number } {
    const f = Math.max(0, Math.min(1, fraction));
    const idx = f * (data.length - 1);
    const i0 = Math.floor(idx);
    const t = idx - i0;
    const price = data[i0] + ((data[i0 + 1] ?? data[i0]) - data[i0]) * t;
    return { xPct: f * 100, yPct: yOf(price), price };
  }

  function scrubTo(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const f = (clientX - rect.left) / rect.width;
    const c = pointAt(f);
    setCursor(c);
    onScrub?.({ price: c.price, index: Math.round(Math.max(0, Math.min(1, f)) * (data.length - 1)) });
  }
  function endScrub() {
    setCursor(null);
    onScrub?.(null);
  }

  if (series.length < 2) return <div style={{ height }} />;
  const color = up ? "var(--pos)" : "var(--neg)";
  const pts = series.map((v, i) => [(i / (series.length - 1)) * 100, yOf(v)] as const);
  const line = smoothPath(pts);
  const area = `${line} L 100 100 L 0 100 Z`;
  const last = pts[pts.length - 1];
  // Keep the price pill from clipping at the chart edges.
  const pillLeft = cursor ? Math.max(15, Math.min(85, cursor.xPct)) : 0;

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", height, touchAction: cursor ? "none" : "pan-y", cursor: "crosshair" }}
      role="img"
      aria-label={label ?? "Price chart"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (cursor || e.buttons > 0 || e.pointerType === "touch") scrubTo(e.clientX);
      }}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onPointerLeave={endScrub}
    >
      <svg
        width="100%"
        height={height}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={`pc${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((gy) => (
          <line
            key={gy}
            x1="0"
            y1={gy}
            x2="100"
            y2={gy}
            stroke="var(--line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            opacity="0.45"
          />
        ))}
        <path d={area} fill={`url(#pc${id})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* scrub cursor — full-height guide line at the finger */}
        {cursor && (
          <line
            x1={cursor.xPct}
            y1="0"
            x2={cursor.xPct}
            y2="100"
            stroke="var(--ink-3)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            opacity="0.7"
          />
        )}
      </svg>

      {/* glowing end dot — hidden while scrubbing so there's a single marker */}
      {!cursor && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${last[0]}%`,
            top: `${last[1]}%`,
            width: 11,
            height: 11,
            marginLeft: -5.5,
            marginTop: -5.5,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 20%, transparent)`,
          }}
        />
      )}

      {/* scrub marker + price pill */}
      {cursor && (
        <>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: `${cursor.xPct}%`,
              top: `${cursor.yPct}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              borderRadius: "50%",
              background: color,
              border: "2px solid var(--surface)",
              boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)`,
            }}
          />
          <span
            aria-hidden
            className="tnum"
            style={{
              position: "absolute",
              left: `${pillLeft}%`,
              top: 0,
              transform: "translateX(-50%)",
              padding: "3px 9px",
              borderRadius: 999,
              background: "var(--ink)",
              color: "var(--paper)",
              fontSize: 12.5,
              fontWeight: 700,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              boxShadow: "var(--shadow)",
            }}
          >
            ${cursor.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </>
      )}
    </div>
  );
}

export interface RiskMeterProps {
  /** 1..5 */
  level?: number;
  label?: string;
}

export function RiskMeter({ level = 3, label }: RiskMeterProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            style={{
              width: 22,
              height: 6,
              borderRadius: 3,
              background: i <= level ? "var(--primary)" : "var(--line)",
              transformOrigin: "left center",
              transition: `background .28s var(--ease-out), transform .28s var(--ease-out)`,
              transitionDelay: `${(i - 1) * 0.04}s`,
            }}
          />
        ))}
      </div>
      {label && (
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
      )}
    </div>
  );
}

export interface DonutSegment {
  value: number;
  color: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}

export function Donut({ segments, size = 116, thickness = 16, center }: DonutProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const tot = segments.reduce((s, x) => s + x.value, 0) || 1;
  // Animate the sweep on mount: start collapsed, then grow to full length on the
  // next frame so the ring "draws" in. Respects reduced-motion (renders full).
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDrawn(true);
      return;
    }
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  // Each arc's length and its cumulative start offset, computed up front so the
  // render stays pure (no accumulator mutated while mapping to JSX).
  const lens = segments.map((s) => (s.value / tot) * c);
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => {
          const len = lens[i];
          const off = offsets[i];
          const shown = Math.max(len - 3, 0.5);
          // gap that grows from full (hidden) to the true gap (drawn).
          const dash = drawn ? shown : 0.5;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-off}
              style={{
                transition:
                  "stroke-dasharray .7s var(--ease-out), stroke-dashoffset .7s var(--ease-out)",
                transitionDelay: `${i * 0.07}s`,
              }}
            />
          );
          return el;
        })}
      </svg>
      {center && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
          }}
        >
          {center}
        </div>
      )}
    </div>
  );
}

export interface CountUpProps {
  to: number;
  dur?: number;
  prefix?: string;
  /** Decimal places. */
  dp?: number;
}

// Animated count-up number, GSAP-driven. Renders the formatted final value on
// the server / first paint (so a frozen or throttled animation clock still shows
// the correct number), then tweens a proxy from the previously shown value and
// writes textContent directly — 60fps with zero React re-renders.
export function CountUp({ to, dur = 550, prefix = "$", dp = 2 }: CountUpProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  // Last value actually painted — starts at the final value (frozen-clock safety).
  const shownRef = useRef(to);
  // Initial render = formatted final value (SSR-safe). After mount GSAP owns the
  // text node, so React must never rewrite it — hence the frozen initial string.
  const [initial] = useState(
    () =>
      prefix + to.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }),
  );

  useGSAP(
    () => {
      const el = spanRef.current;
      if (!el) return;
      const fmt = (n: number) =>
        prefix +
        n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const proxy = { v: shownRef.current };
        gsap.to(proxy, {
          v: to,
          duration: dur / 1000,
          ease: "power2.out",
          onUpdate: () => {
            shownRef.current = proxy.v;
            el.textContent = fmt(proxy.v);
          },
        });
      });
      // Reduced motion: snap straight to the final value, no tween.
      mm.add("(prefers-reduced-motion: reduce)", () => {
        shownRef.current = to;
        el.textContent = fmt(to);
      });
      return () => mm.revert();
    },
    { scope: spanRef, dependencies: [to], revertOnUpdate: true },
  );

  return (
    <span ref={spanRef} className="tnum">
      {initial}
    </span>
  );
}
