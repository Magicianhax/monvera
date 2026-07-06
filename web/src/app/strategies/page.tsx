import type { Metadata } from "next";
import { getPublicStrategies, type StrategyBacktest } from "@/lib/server/strategies";
import { displayFor } from "@/lib/displayAssets";

export const metadata: Metadata = {
  title: "Open strategies",
  description:
    "Monvera's public strategy book: deterministic, rule-based portfolios of tokenized stocks, rebuilt from real market data and backtested in the open. Raw JSON at /api/strategies.",
  alternates: { canonical: "/strategies" },
  openGraph: {
    title: "Monvera · Open strategies",
    description:
      "Deterministic, rule-based portfolios of tokenized stocks: methods, weights, and backtests published in the open.",
    url: "/strategies",
  },
};

// Public, world-readable (not geo-gated: it moves no money). Server-rendered
// from the same strategy engine the app uses; revalidates hourly.
export const revalidate = 3600;

// Server-safe dual sparkline: strategy (accent, filled) vs SPY (dashed).
function Curve({ bt }: { bt: StrategyBacktest }) {
  const W = 560;
  const H = 110;
  const all = [...bt.portfolio.curve, ...bt.benchmark.curve];
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const pts = (curve: number[]) =>
    curve
      .map((v, i) => `${((i / (curve.length - 1)) * W).toFixed(1)},${(H - 8 - ((v - min) / span) * (H - 16)).toFixed(1)}`)
      .join(" ");
  const plan = pts(bt.portfolio.curve);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }} role="img" aria-label="6-month walk-forward backtest curve vs S&P 500">
      <polygon points={`0,${H} ${plan} ${W},${H}`} fill="var(--accent)" opacity={0.1} />
      <polyline points={pts(bt.benchmark.curve)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
      <polyline points={plan} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>{label}</div>
      <div className="tnum" style={{ fontSize: 19, fontWeight: 700, color: accent ? "var(--accent)" : "var(--ink)", letterSpacing: "-.01em" }}>
        {value}
      </div>
    </div>
  );
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export default async function StrategiesPage() {
  const data = await getPublicStrategies();
  return (
    <div className="stax" data-mode="light" style={{ minHeight: "100vh", background: "var(--app-bg, var(--paper))" }}>
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 22px 80px" }}>
        <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)", margin: 0 }}>
          Monvera · open strategies
        </p>
        <h1 className="serif" style={{ fontSize: 40, lineHeight: 1.1, letterSpacing: "-.02em", margin: "10px 0 14px" }}>
          Our strategy book, published in the open.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink-2)", margin: 0, maxWidth: 560 }}>
          Three rule-based portfolios of tokenized stocks. No black box: each method is spelled out
          below, the weights are recomputed from real market data every 6 hours, and every rule is
          backtested WALK-FORWARD: at each monthly rebalance it sees only the data it would have
          had at that moment, then holds out-of-sample. No picking last year&apos;s winners and
          calling it a backtest. Raw
          JSON, free for anyone to build on:{" "}
          <a href="/api/strategies" style={{ color: "var(--accent)", fontWeight: 600 }}>
            /api/strategies
          </a>
          .
        </p>

        {data.strategies.map((s) => (
          <section key={s.id} id={s.id} className="card" style={{ marginTop: 28, padding: "22px 22px 18px" }}>
            <h2 className="serif" style={{ fontSize: 26, letterSpacing: "-.015em", margin: 0 }}>{s.name}</h2>
            <p style={{ fontSize: 15, color: "var(--ink-2)", margin: "6px 0 16px", lineHeight: 1.5 }}>{s.tagline}</p>

            {s.backtest && (
              <>
                <Curve bt={s.backtest} />
                <div style={{ display: "flex", gap: 26, marginTop: 14, flexWrap: "wrap" }}>
                  <Stat label="This strategy · 6m walk-forward" value={pct(s.backtest.portfolio.returnPct)} accent />
                  <Stat label="S&P 500 · same window" value={pct(s.backtest.benchmark.returnPct)} />
                  <Stat label="Worst dip" value={`−${s.backtest.portfolio.maxDrawdownPct.toFixed(1)}%`} />
                  <Stat label="Sharpe" value={s.backtest.portfolio.sharpe.toFixed(2)} />
                </div>
              </>
            )}

            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", height: 12, borderRadius: 99, overflow: "hidden", gap: 2 }}>
                {s.allocations.map((a) => (
                  <div key={a.symbol} style={{ width: `${a.weightPct}%`, background: displayFor(a.symbol).color }} title={`${a.symbol} ${a.weightPct}%`} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
                {s.allocations.map((a) => (
                  <span key={a.symbol} style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: displayFor(a.symbol).color, marginRight: 5 }} />
                    {a.symbol} <b className="tnum" style={{ color: "var(--ink)" }}>{a.weightPct}%</b>
                  </span>
                ))}
              </div>
            </div>

            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 13.5, fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}>
                The full rule (reproduce it yourself)
              </summary>
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "8px 0 0" }}>{s.method}</p>
            </details>
          </section>
        ))}

        <p style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6, marginTop: 26 }}>
          {data.note} Weights as of {new Date(data.asOf).toUTCString()}.
        </p>
      </main>
    </div>
  );
}
