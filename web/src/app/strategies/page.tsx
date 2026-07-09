import type { Metadata } from "next";
import { getPublicStrategies } from "@/lib/server/strategies";
import { displayFor } from "@/lib/displayAssets";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import { StrategyCurve, pctLabel } from "@/components/site/StrategyCurve";
import s from "./strategies.module.css";

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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={s.stat}>
      <div className={s.statLabel}>{label}</div>
      <div className={`${s.statValue} ${accent ? s.statAccent : ""}`}>{value}</div>
    </div>
  );
}

export default async function StrategiesPage() {
  const data = await getPublicStrategies();

  return (
    <SiteDocShell
      wide
      eyebrow="Open strategies"
      title="Our strategy book, published in the open"
      lead={
        <>
          Three rule-based portfolios of tokenized stocks, with no black box. Each method is spelled out below, the
          weights are recomputed from real market data every six hours, and every rule is backtested walk-forward: at
          each monthly rebalance it sees only the data it would have had at that moment, then holds out of sample. No
          picking last year&apos;s winners and calling it a backtest. The raw JSON is free for anyone to build on at{" "}
          <a className={s.inlineLink} href="/api/strategies">/api/strategies</a>.
        </>
      }
    >
      <div className={s.book}>
        {data.strategies.map((st) => (
          <section key={st.id} id={st.id} className={s.strategy}>
            <div className={s.head}>
              <h2 className={s.name}>{st.name}</h2>
              <p className={s.tagline}>{st.tagline}</p>
            </div>

            {st.backtest && (
              <>
                <StrategyCurve bt={st.backtest} />
                <div className={s.stats}>
                  <Stat label="This strategy · 6m walk-forward" value={pctLabel(st.backtest.portfolio.returnPct)} accent />
                  <Stat label="S&P 500 · same window" value={pctLabel(st.backtest.benchmark.returnPct)} />
                  <Stat label="Worst dip" value={`−${st.backtest.portfolio.maxDrawdownPct.toFixed(1)}%`} />
                  <Stat label="Sharpe" value={st.backtest.portfolio.sharpe.toFixed(2)} />
                </div>
              </>
            )}

            <div className={s.weights}>
              <div className={s.bar}>
                {st.allocations.map((a) => (
                  <div
                    key={a.symbol}
                    style={{ width: `${a.weightPct}%`, background: displayFor(a.symbol).color }}
                    title={`${a.symbol} ${a.weightPct}%`}
                  />
                ))}
              </div>
              <div className={s.legend}>
                {st.allocations.map((a) => (
                  <span key={a.symbol} className={s.legendItem}>
                    <span className={s.swatch} style={{ background: displayFor(a.symbol).color }} />
                    {a.symbol} <b>{a.weightPct}%</b>
                  </span>
                ))}
              </div>
            </div>

            <details className={s.rule}>
              <summary>The full rule, so you can reproduce it</summary>
              <p>{st.method}</p>
            </details>
          </section>
        ))}
      </div>

      <p className={s.asOf}>
        {data.note} Weights as of {new Date(data.asOf).toUTCString()}.
      </p>
    </SiteDocShell>
  );
}
