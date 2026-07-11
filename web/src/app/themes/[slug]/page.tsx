import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicThemes, getThemeDef, THEME_DEFS } from "@/lib/server/themes";
import { displayFor } from "@/lib/displayAssets";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import { StrategyCurve, pctLabel } from "@/components/site/StrategyCurve";
import book from "../../strategies/strategies.module.css";
import s from "../themes.module.css";

// Public, world-readable theme basket pages (not geo-gated: they move no
// money). Same engine and honesty rules as /strategies; revalidates hourly.
export const revalidate = 3600;

export function generateStaticParams() {
  return THEME_DEFS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const def = getThemeDef(slug);
  if (!def) return {};
  return {
    title: `${def.name} basket`,
    description: `${def.tagline} A deterministic ${def.name} basket of tokenized stocks: inverse-volatility weights from real 12-month data, backtested walk-forward vs SPY. Raw JSON at /api/themes.`,
    alternates: { canonical: `/themes/${slug}` },
    openGraph: {
      title: `Monvera · ${def.name} basket`,
      description: `${def.tagline} Method, weights, and an honest walk-forward backtest, published in the open.`,
      url: `/themes/${slug}`,
    },
  };
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={book.stat}>
      <div className={book.statLabel}>{label}</div>
      <div className={`${book.statValue} ${accent ? book.statAccent : ""}`}>{value}</div>
    </div>
  );
}

export default async function ThemePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = getThemeDef(slug);
  if (!def) notFound();

  const data = await getPublicThemes();
  const t = data.themes.find((x) => x.slug === slug);
  if (!t) notFound();

  return (
    <SiteDocShell
      wide
      eyebrow="Theme baskets"
      title={`The ${t.name} basket`}
      lead={
        <>
          <Link className={s.backLink} href="/themes">← All themes</Link>
          <br />
          {t.tagline} Built by the same open engine as the{" "}
          <Link className={s.inlineLink} href="/strategies">strategy book</Link>: the full rule is below,
          the weights recompute from real market data every six hours, and the backtest is walk-forward,
          so it never picks last year&apos;s winners. Raw JSON for this and every theme at{" "}
          <a className={s.inlineLink} href="/api/themes">/api/themes</a>.
        </>
      }
    >
      <div className={book.book}>
        <section className={book.strategy}>
          {t.backtest && (
            <>
              <StrategyCurve bt={t.backtest} />
              <div className={book.stats}>
                <Stat label={`${t.name} · 6m walk-forward`} value={pctLabel(t.backtest.portfolio.returnPct)} accent />
                <Stat label="S&P 500 · same window" value={pctLabel(t.backtest.benchmark.returnPct)} />
                <Stat label="Worst dip" value={`−${t.backtest.portfolio.maxDrawdownPct.toFixed(1)}%`} />
                <Stat label="Sharpe" value={t.backtest.portfolio.sharpe.toFixed(2)} />
              </div>
            </>
          )}

          <div className={book.weights}>
            <div className={book.bar}>
              {t.allocations.map((a) => (
                <div
                  key={a.symbol}
                  style={{ width: `${a.weightPct}%`, background: displayFor(a.symbol).color }}
                  title={`${a.symbol} ${a.weightPct}%`}
                />
              ))}
            </div>
            <div className={book.legend}>
              {t.allocations.map((a) => {
                const name = displayFor(a.symbol).name;
                return (
                  <span key={a.symbol} className={book.legendItem}>
                    <span className={book.swatch} style={{ background: displayFor(a.symbol).color }} />
                    {name && name !== a.symbol ? `${name} · ` : ""}{a.symbol} <b>{a.weightPct}%</b>
                  </span>
                );
              })}
            </div>
          </div>

          <details className={book.rule}>
            <summary>The full rule, so you can reproduce it</summary>
            <p>{t.method}</p>
          </details>

          {t.excluded.length > 0 && (
            <p className={s.excluded}>
              <b>Excluded from this basket:</b>{" "}
              {t.excluded.map((e) => `${e.symbol} (${e.reason})`).join(", ")}. We name exclusions instead
              of inventing data for them.
            </p>
          )}
        </section>
      </div>

      <p className={book.asOf}>
        {data.note} Weights as of {new Date(data.asOf).toUTCString()}.
      </p>
    </SiteDocShell>
  );
}
