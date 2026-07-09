// The walk-forward backtest curve: the strategy (solid, filled) against the
// S&P 500 (dashed). Presentational and server-safe; styled from the committed
// `.site` tokens so it reads the same on the landing and in the strategy book.

import type { StrategyBacktest } from "@/lib/server/strategies";

export function StrategyCurve({ bt, height = 110 }: { bt: StrategyBacktest; height?: number }) {
  const W = 560;
  const H = height;
  const all = [...bt.portfolio.curve, ...bt.benchmark.curve];
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const pad = Math.max(6, H * 0.07);
  const pts = (curve: number[]) =>
    curve
      .map((v, i) => `${((i / (curve.length - 1)) * W).toFixed(1)},${(H - pad - ((v - min) / span) * (H - pad * 2)).toFixed(1)}`)
      .join(" ");
  const plan = pts(bt.portfolio.curve);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block" }}
      role="img"
      aria-label={`Six month walk-forward backtest: the strategy returned ${bt.portfolio.returnPct.toFixed(1)} percent against ${bt.benchmark.returnPct.toFixed(1)} percent for the S&P 500`}
    >
      <polygon points={`0,${H} ${plan} ${W},${H}`} fill="var(--s-primary)" opacity={0.1} />
      <polyline
        points={pts(bt.benchmark.curve)}
        fill="none"
        stroke="var(--s-ink-3)"
        strokeWidth={1.5}
        strokeDasharray="5 5"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={plan}
        fill="none"
        stroke="var(--s-primary-d)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export const pctLabel = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
