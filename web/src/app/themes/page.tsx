import type { Metadata } from "next";
import Link from "next/link";
import { getPublicThemes } from "@/lib/server/themes";
import { displayFor } from "@/lib/displayAssets";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import { pctLabel } from "@/components/site/StrategyCurve";
import s from "./themes.module.css";

export const metadata: Metadata = {
  title: "Theme baskets",
  description:
    "The open theme book: one deterministic basket per investing theme (AI, semiconductors, space, quantum and more) of tokenized stocks, rebuilt from real market data and backtested walk-forward vs SPY. Raw JSON at /api/themes.",
  alternates: { canonical: "/themes" },
  openGraph: {
    title: "Monvera · Theme baskets",
    description:
      "Deterministic theme baskets of tokenized stocks: AI, semiconductors, space, quantum and more, with methods, weights, and backtests published in the open.",
    url: "/themes",
  },
};

// Public, world-readable (not geo-gated: it moves no money). Server-rendered
// from the same engine as /strategies; revalidates hourly.
export const revalidate = 3600;

export default async function ThemesPage() {
  const data = await getPublicThemes();

  return (
    <SiteDocShell
      wide
      eyebrow="Theme baskets"
      title="Every theme, as an honest basket"
      lead={
        <>
          One rule-based basket per investing theme, built by the same open engine as our{" "}
          <Link className={s.inlineLink} href="/strategies">strategy book</Link>: real 12-month closes,
          inverse-volatility weights, and a walk-forward backtest against the S&amp;P 500 that only ever
          sees the data it would have had at the time. Names without a year of public history are excluded
          and listed by name. The raw JSON is free for anyone (including agents) to build on at{" "}
          <a className={s.inlineLink} href="/api/themes">/api/themes</a>.
        </>
      }
    >
      <div className={s.grid}>
        {data.themes.map((t) => (
          <Link key={t.slug} href={`/themes/${t.slug}`} className={s.card}>
            <h2 className={s.cardName}>{t.name}</h2>
            <p className={s.cardTagline}>{t.tagline}</p>
            <div className={s.cardStats}>
              <span>
                6m walk-forward <b className={t.backtest && t.backtest.portfolio.returnPct >= 0 ? s.pos : ""}>
                  {t.backtest ? pctLabel(t.backtest.portfolio.returnPct) : "n/a"}
                </b>
              </span>
              <span>
                S&amp;P 500 <b>{t.backtest ? pctLabel(t.backtest.benchmark.returnPct) : "n/a"}</b>
              </span>
              <span>
                Names <b>{t.allocations.length}</b>
              </span>
            </div>
            <div className={s.cardBar}>
              {t.allocations.map((a) => (
                <div
                  key={a.symbol}
                  style={{ width: `${a.weightPct}%`, background: displayFor(a.symbol).color }}
                  title={`${a.symbol} ${a.weightPct}%`}
                />
              ))}
            </div>
            <div className={s.cardMore}>View the basket →</div>
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 28 }}>
        {data.note} Weights as of {new Date(data.asOf).toUTCString()}.
      </p>
    </SiteDocShell>
  );
}
