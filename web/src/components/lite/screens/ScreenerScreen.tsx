"use client";

// Live screener — the buyable universe ranked by real 12-month numbers, in
// plain words. Sort by 1-year return, 3-month momentum, steadiness (volatility),
// or worst dip (drawdown). Pure new consumer of /api/screener (cached server
// stats, shared with Vera's allocator); no new data pipeline.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { displayFor } from "@/lib/displayAssets";
import { TokenLogo } from "../TokenLogo";
import { Icon } from "@/components/design";
import { iconBtn, boxHead, innerBox } from "./primitives";

interface ScreenerRow {
  symbol: string;
  ret1yPct: number | null;
  ret3mPct: number | null;
  volPct: number | null;
  maxDrawdownPct: number | null;
}

interface ScreenerResponse {
  assets: ScreenerRow[];
  asOf: string;
}

type MetricKey = "ret1y" | "ret3m" | "steady" | "dip";

// Each metric: the number it ranks by, which way is "better", and how the row's
// right-hand value reads. Higher-is-better metrics sort descending; steadiness
// and worst dip sort ascending (smaller number = calmer / shallower).
const METRICS: {
  key: MetricKey;
  label: string;
  get: (r: ScreenerRow) => number | null;
  dir: "desc" | "asc";
}[] = [
  { key: "ret1y", label: "1y return", get: (r) => r.ret1yPct, dir: "desc" },
  { key: "ret3m", label: "3 months", get: (r) => r.ret3mPct, dir: "desc" },
  { key: "steady", label: "Steadiest", get: (r) => r.volPct, dir: "asc" },
  { key: "dip", label: "Smallest dip", get: (r) => r.maxDrawdownPct, dir: "asc" },
];

function fmtSigned(v: number): string {
  const n = Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1);
  return `${v >= 0 ? "+" : ""}${n}%`;
}

function fmtPlain(v: number): string {
  return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

// Volatility in plain words. These are single stocks, so the bands sit higher
// than a diversified fund would.
function steadiness(vol: number | null): string {
  if (vol === null) return "";
  if (vol <= 30) return "Steady";
  if (vol <= 55) return "Typical";
  return "Jumpy";
}

export function ScreenerScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const [metricKey, setMetricKey] = useState<MetricKey>("ret1y");
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["screener"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch("/api/screener");
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load the screener.");
      return json as ScreenerResponse;
    },
  });

  const rows = data?.assets ?? [];
  // Null values (e.g. missing 3-month) always sort to the bottom.
  const sorted = [...rows].sort((a, b) => {
    const av = metric.get(a);
    const bv = metric.get(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return metric.dir === "desc" ? bv - av : av - bv;
  });

  const RightValue = ({ r }: { r: ScreenerRow }) => {
    if (metricKey === "steady") {
      return <span className="tnum" style={{ fontWeight: 500, fontSize: 14.5, color: "var(--ink-2)" }}>{r.volPct !== null ? `${Math.round(r.volPct)}%` : "—"}</span>;
    }
    if (metricKey === "dip") {
      return <span className="tnum" style={{ fontWeight: 500, fontSize: 14.5, color: "var(--neg)" }}>{r.maxDrawdownPct !== null ? `-${fmtPlain(r.maxDrawdownPct)}%` : "—"}</span>;
    }
    const v = metric.get(r);
    if (v === null) return <span className="tnum" style={{ fontSize: 14.5, color: "var(--ink-3)" }}>—</span>;
    return <span className="tnum" style={{ fontWeight: 500, fontSize: 14.5, color: v >= 0 ? "var(--pos)" : "var(--neg)" }}>{fmtSigned(v)}</span>;
  };

  const Row = ({ r, rank }: { r: ScreenerRow; rank: number }) => {
    const d = displayFor(r.symbol);
    const word = steadiness(r.volPct);
    return (
      <button className="tap" onClick={() => go("asset", { symbol: r.symbol })} style={{ ...innerBox }}>
        <span className="tnum" style={{ flex: "none", width: 20, textAlign: "right", fontSize: 13, color: "var(--ink-3)" }}>{rank}</span>
        <TokenLogo symbol={r.symbol} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 15, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono">{r.symbol}</span>
            {word && <span style={{ opacity: 0.5 }}>·</span>}
            {word && <span>{word}</span>}
          </div>
        </div>
        <div style={{ flex: "none", textAlign: "right", minWidth: 58 }}>
          <RightValue r={r} />
        </div>
      </button>
    );
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Live screener</h1>
      </div>

      <p style={{ margin: 0, padding: "6px 22px 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        The buyable list, ranked by the numbers that matter. History, not a promise.
      </p>

      {/* metric chooser — scrolls sideways on narrow screens */}
      <div style={{ display: "flex", gap: 8, padding: "16px 22px 0", overflowX: "auto", scrollbarWidth: "none" }}>
        {METRICS.map((m) => {
          const on = m.key === metricKey;
          return (
            <button key={m.key} onClick={() => setMetricKey(m.key)} className={`chip tap ${on ? "is-on" : ""}`} style={{ flex: "none", height: 32, whiteSpace: "nowrap" }} aria-pressed={on}>
              {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "18px 22px 0" }}>
        {isError ? (
          <div className="card" style={{ padding: 16, fontSize: 13.5, color: "var(--ink-2)" }}>
            Couldn&apos;t load the screener right now. Please try again in a moment.
          </div>
        ) : isLoading ? (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Ranking the universe</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{ ...innerBox }}>
                  <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 12, flex: "none" }} />
                  <div style={{ flex: 1 }}><div className="skeleton" style={{ width: "50%", height: 13, borderRadius: 5 }} /><div className="skeleton" style={{ width: "30%", height: 10, borderRadius: 5, marginTop: 7 }} /></div>
                  <div className="skeleton" style={{ width: 48, height: 20, borderRadius: 5 }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Ranked by {metric.label.toLowerCase()}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sorted.map((r, i) => <Row key={r.symbol} r={r} rank={i + 1} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
