import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { getGroves } from "@/lib/server/groveService";
import { withTimeout } from "@/lib/server/withTimeout";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { GroveCover } from "@/components/GroveCover";
import { Arrow, SiteFooterV4, SiteNavV4 } from "@/components/site/SiteChromeV4";
import { pctLabel } from "@/components/site/StrategyCurve";
import { usdWhole } from "@/lib/format";
import v4 from "@/components/site/SiteLandingV4.module.css";
import s from "./groves.module.css";

// The Grove shelf — public, world-readable (it moves no money; buying happens
// in the app). Server-rendered from the same registry + live layer the API
// serves; revalidates every 5 minutes so prices stay honest without hammering
// the RPC. Styled to mirror the in-app shelf: card-first, numbers over prose.
export const revalidate = 300;

export const metadata: Metadata = pageMeta({
  title: "Groves — curated stock baskets",
  // One sentence, and never the word "free" — every swap still pays venue
  // spread inside the quote; only Monvera's own fee schedule is $0-until-exit.
  description:
    "Curated baskets of real tokenized stocks, bought into your own wallet — $0 entry, $0 management, the only fee is 10% of profit when you exit.",
  path: "/groves",
});

export default async function GrovesPage() {
  // Ceiling on the live layer: prices + backtests hit the network, and a hang
  // here blanked the page. On timeout the registry still renders (compositions,
  // weights, fees are static) — only live prices/backtests are missing.
  const data = await withTimeout(getGroves(), 4000, null, "groves:list");
  if (!data) {
    return (
      <div className={`site ${v4.root} ${s.shell}`} data-mode="dark">
        <SiteNavV4 />
        <main className={s.main}>
          <header className={s.hero}>
            <p className={v4.eyebrow}>Monvera Groves</p>
            <h1 className={`${v4.display} ${s.h1}`}>Taking a moment</h1>
            <p className={s.lead}>
              Live prices are slow to answer right now — refresh in a moment.
              Compositions, weights, and rules are unchanged.
            </p>
          </header>
        </main>
        <SiteFooterV4 />
      </div>
    );
  }
  const agg = data.groves.reduce(
    (s2, g) => ({
      users: s2.users + g.stats.users,
      managedUsd: s2.managedUsd + g.stats.managedUsd,
      feesUsd: s2.feesUsd + g.stats.feesUsd,
    }),
    { users: 0, managedUsd: 0, feesUsd: 0 },
  );
  const anyDeployed = data.groves.some((g) => g.stats.deployed);

  return (
    <div className={`site ${v4.root} ${s.shell}`} data-mode="dark">
      <SiteNavV4 />
      <main className={s.main}>
        {/* Hero — eyebrow, headline, ONE lead line, one CTA. The honesty facts
            live in the stat band and on every card, not in hero prose. */}
        <header className={s.hero}>
          <p className={v4.eyebrow}>Monvera Groves</p>
          <h1 className={`${v4.display} ${s.h1}`}>
            Strategies you own, <em>not funds you buy</em>
          </h1>
          <p className={s.lead}>
            Curated baskets of real tokenized stocks, bought into your own wallet — every
            weight public.
          </p>
          {/* This page is read-only — buying happens in the app, so say so. */}
          <div className={s.ctaRow}>
            <Link href="/app" className={v4.cta}>
              Buy in the app <Arrow />
            </Link>
          </div>
        </header>

        {/* Aggregate counters — honest zeros until the GroveManager contract
            opens, live on-chain reads after. One row, scrolls before it wraps. */}
        <section className={`${v4.glass} ${s.band}`} aria-label="All-Groves stats">
          <div className={s.bandStrip}>
            <div className={s.bandCell}>
              <span className={s.microLbl}>Investors</span>
              <span className={s.bandVal}>{agg.users.toLocaleString("en-US")}</span>
              <span className={s.bandSub}>across all Groves</span>
            </div>
            <div className={s.bandCell}>
              <span className={s.microLbl}>Managed</span>
              <span className={s.bandVal}>{usdWhole(agg.managedUsd)}</span>
              <span className={s.bandSub}>on-chain cost basis</span>
            </div>
            <div className={s.bandCell}>
              <span className={s.microLbl}>Fees paid so far</span>
              <span className={s.bandVal}>{usdWhole(agg.feesUsd)}</span>
              <span className={s.bandSub}>10% of realized profit only</span>
            </div>
          </div>
          <p className={s.bandNote}>
            {anyDeployed
              ? "Read live from the GroveManager contract — public and verifiable on-chain."
              : "Honest zeros — the counters read straight from the GroveManager contract from day one."}
          </p>
        </section>

        <div className={s.grid}>
          {data.groves.map((g) => {
            const top = [...g.components].sort((a, b) => b.weightBps - a.weightBps).slice(0, 4);
            const rest = g.components.length - top.length;
            const btUp = (g.backtest?.portfolio.returnPct ?? 0) >= 0;
            return (
              <Link key={g.id} href={`/groves/${g.id}`} className={`${v4.glass} ${s.card}`}>
                {/* generative cover art (or the registry's raster override) */}
                <div className={s.cover}>
                  <GroveCover id={g.id} coverImage={g.coverImage} />
                  {!g.stats.deployed && <span className={`${s.soon} ${s.soonOverlay}`}>Opens soon</span>}
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardTop}>
                    <span className={s.ticker}>{g.ticker}</span>
                    <span className={s.chip}>{g.category}</span>
                  </div>
                  <h2 className={s.cardName}>{g.name}</h2>
                  <p className={s.cardThesis}>{g.thesis}</p>

                  <div className={s.logoRow} aria-label={`Top holdings: ${top.map((c) => c.symbol).join(", ")}`}>
                    {top.map((c) => (
                      <span key={c.symbol} className={s.logoRing}>
                        <TokenLogo symbol={c.symbol} name={c.name} size={28} />
                      </span>
                    ))}
                    {rest > 0 && <span className={s.moreCount}>+{rest} more</span>}
                  </div>

                  <div className={s.cardStats}>
                    <div className={s.cardStat}>
                      <span className={s.cardStatLbl}>1y backtest</span>
                      <span className={`${s.cardStatVal} ${btUp ? s.pos : s.neg}`}>
                        {g.backtest ? pctLabel(g.backtest.portfolio.returnPct) : "—"}
                      </span>
                    </div>
                    <div className={s.cardStat}>
                      <span className={s.cardStatLbl}>S&amp;P · same yr</span>
                      <span className={`${s.cardStatVal} ${s.dim}`}>
                        {g.backtest ? pctLabel(g.backtest.benchmark.returnPct) : "—"}
                      </span>
                    </div>
                    <div className={s.cardStat}>
                      <span className={s.cardStatLbl}>Min buy</span>
                      <span className={s.cardStatVal}>{usdWhole(g.minBuyUsd)}</span>
                    </div>
                    {/* Always shown, zeros included — the row goes live with the contract. */}
                    <div className={s.cardStat}>
                      <span className={s.cardStatLbl}>{g.stats.users === 1 ? "Investor" : "Investors"}</span>
                      <span className={s.cardStatVal}>
                        {g.stats.users.toLocaleString("en-US")}{" "}
                        <span className={s.subtle}>· {usdWhole(g.stats.managedUsd)}</span>
                      </span>
                    </div>
                  </div>

                  {/* One mono line carries the fee fact on every card. */}
                  <div className={s.cardFoot}>
                    <span className={s.feeLine}>
                      From {usdWhole(g.minBuyUsd)} · {g.feeBps / 100}% of profit at exit
                    </span>
                    <span className={s.cardArrow} aria-hidden>
                      <Arrow />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* One centered line — not the API's whole disclaimer paragraph. */}
        <p className={s.footnote}>
          Backtests are history, not promises · every weight and rule is public on each
          Grove&apos;s page
        </p>
      </main>
      <SiteFooterV4 />
    </div>
  );
}
