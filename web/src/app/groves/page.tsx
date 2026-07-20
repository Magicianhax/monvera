import type { Metadata } from "next";
import Link from "next/link";
import { getGroves } from "@/lib/server/groveService";
import { grovePreviewMinUsd } from "@/lib/groves";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { Arrow, SiteFooterV4, SiteNavV4 } from "@/components/site/SiteChromeV4";
import { pctLabel } from "@/components/site/StrategyCurve";
import { usdWhole } from "@/lib/format";
import v4 from "@/components/site/SiteLandingV4.module.css";
import s from "./groves.module.css";

// The Grove shelf — public, world-readable (it moves no money; buying happens
// in the app). Server-rendered from the same registry + live layer the API
// serves; revalidates every 5 minutes so prices stay honest without hammering
// the RPC. Raw JSON twin: /api/groves.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Groves — curated stock baskets",
  description:
    "Curated baskets of real tokenized stocks, bought straight into your own wallet. Free to enter, free to hold — the only fee is 10% of profit when you exit. Composition, backtests, and every trade published in the open.",
  alternates: { canonical: "/groves" },
  openGraph: {
    title: "Monvera Groves — strategies you own, not funds you buy",
    description:
      "Curated baskets of real tokenized stocks, held in your own wallet. $0 entry, $0 management — 10% of profit when you exit is the whole fee.",
    url: "/groves",
  },
};

export default async function GrovesPage() {
  const data = await getGroves();

  return (
    <div className={`site ${v4.root} ${s.shell}`} data-mode="dark">
      <SiteNavV4 />
      <main className={s.main}>
        <header className={s.hero}>
          <p className={v4.eyebrow}>Monvera Groves</p>
          <h1 className={`${v4.display} ${s.h1}`}>
            Strategies you own, <em>not funds you buy</em>
          </h1>
          <p className={s.lead}>
            A Grove is a curated basket of real tokenized stocks that Vera buys straight into
            your own wallet and manages in the open — composition, weights, backtests, and every
            trade published, non-custodial from the first share.
          </p>
          <p className={s.feeSentence}>
            Free to enter, free to hold. 10% of profit when you exit — that is the whole fee.
          </p>
        </header>

        <div className={s.grid}>
          {data.groves.map((g) => {
            const top = [...g.components].sort((a, b) => b.weightBps - a.weightBps).slice(0, 4);
            const rest = g.components.length - top.length;
            return (
              <Link key={g.id} href={`/groves/${g.id}`} className={`${v4.glass} ${s.card}`}>
                <div className={s.cardTop}>
                  <span className={s.ticker}>{g.ticker}</span>
                  <span className={s.chip}>{g.category}</span>
                  {!g.stats.deployed && <span className={s.soon}>Opens soon</span>}
                </div>
                <h2 className={s.cardName}>{g.name}</h2>
                <p className={s.cardThesis}>{g.thesis}</p>

                <div className={s.logoRow} aria-label={`Top holdings: ${top.map((c) => c.symbol).join(", ")}`}>
                  {top.map((c) => (
                    <span key={c.symbol} className={s.logoRing}>
                      <TokenLogo symbol={c.symbol} name={c.name} size={30} />
                    </span>
                  ))}
                  {rest > 0 && <span className={s.moreCount}>+{rest} more</span>}
                </div>

                <div className={s.cardStats}>
                  <div className={s.cardStat}>
                    <span className={s.cardStatLbl}>1y backtest</span>
                    <span className={`${s.cardStatVal} ${s.accent}`}>
                      {g.backtest ? pctLabel(g.backtest.portfolio.returnPct) : "—"}
                    </span>
                  </div>
                  <div className={s.cardStat}>
                    <span className={s.cardStatLbl}>S&amp;P 500 · same year</span>
                    <span className={s.cardStatVal}>
                      {g.backtest ? pctLabel(g.backtest.benchmark.returnPct) : "—"}
                    </span>
                  </div>
                  <div className={s.cardStat}>
                    <span className={s.cardStatLbl}>Min buy</span>
                    {/* Preview places each name as its own order, so the real
                        minimum today can sit above the published launch min —
                        show the number the buy flow actually enforces. */}
                    <span className={s.cardStatVal}>
                      {usdWhole(g.stats.deployed ? g.minBuyUsd : grovePreviewMinUsd(g))}
                    </span>
                  </div>
                  {g.stats.deployed ? (
                    <div className={s.cardStat}>
                      <span className={s.cardStatLbl}>{g.stats.users === 1 ? "Investor" : "Investors"}</span>
                      <span className={s.cardStatVal}>
                        {g.stats.users.toLocaleString("en-US")} · {usdWhole(g.stats.managedUsd)}
                      </span>
                    </div>
                  ) : (
                    <div className={s.cardStat}>
                      <span className={s.cardStatLbl}>Holdings</span>
                      <span className={s.cardStatVal}>{g.components.length} stocks</span>
                    </div>
                  )}
                </div>

                <div className={s.cardFoot}>
                  <span className={s.feeLine}>$0 in, $0 to hold · 10% of profit when you exit</span>
                  <span className={s.cardArrow} aria-hidden>
                    <Arrow />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <p className={s.asOf}>
          {data.note} Live data as of {new Date(data.asOf).toUTCString()}. Raw JSON for every
          grove is free at <Link href="/api/groves">/api/groves</Link>.
        </p>
      </main>
      <SiteFooterV4 />
    </div>
  );
}
