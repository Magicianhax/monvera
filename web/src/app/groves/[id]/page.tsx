import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GROVES, groveById, grovePreviewMinUsd, MIN_LEG_USD } from "@/lib/groves";
import { getGrove } from "@/lib/server/groveService";
import type { BacktestResult } from "@/lib/server/quant";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { Arrow, SiteFooterV4, SiteNavV4 } from "@/components/site/SiteChromeV4";
import { pctLabel } from "@/components/site/StrategyCurve";
import { usd, usdWhole } from "@/lib/format";
import v4 from "@/components/site/SiteLandingV4.module.css";
import shell from "../groves.module.css";
import s from "./grove.module.css";

// One Grove, at full density — public and world-readable (buying happens in
// the app). Same live layer as /api/groves/[id]; revalidates every 5 minutes.
export const revalidate = 300;

export function generateStaticParams() {
  return GROVES.map((g) => ({ id: g.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const def = groveById(id.toLowerCase());
  if (!def) return {};
  return {
    title: `${def.ticker} — ${def.name}`,
    description: def.thesis,
    alternates: { canonical: `/groves/${def.id}` },
    openGraph: {
      title: `${def.ticker} — ${def.name} · Monvera`,
      description: def.thesis,
      url: `/groves/${def.id}`,
    },
  };
}

// The 1Y backtest curve vs buy-and-hold SPY — same drawing as the strategy
// book's StrategyCurve, but typed to the quant engine's BacktestResult and
// colored with the emerald-room tokens. Server-safe.
function GroveCurve({ bt, height = 150 }: { bt: BacktestResult; height?: number }) {
  const W = 720;
  const H = height;
  const all = [...bt.portfolio.curve, ...bt.benchmark.curve];
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const pad = Math.max(6, H * 0.07);
  const pts = (curve: number[]) =>
    curve
      .map(
        (v, i) =>
          `${((i / (curve.length - 1)) * W).toFixed(1)},${(H - pad - ((v - min) / span) * (H - pad * 2)).toFixed(1)}`,
      )
      .join(" ");
  const plan = pts(bt.portfolio.curve);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block" }}
      role="img"
      aria-label={`One year backtest: the grove returned ${bt.portfolio.returnPct.toFixed(1)} percent against ${bt.benchmark.returnPct.toFixed(1)} percent for the S&P 500`}
    >
      <polygon points={`0,${H} ${plan} ${W},${H}`} fill="var(--primary)" opacity={0.1} />
      <polyline
        points={pts(bt.benchmark.curve)}
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth={1.5}
        strokeDasharray="5 5"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={plan}
        fill="none"
        stroke="var(--primary-bright)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Markdown-lite for the registry's methodology strings: blank-line paragraphs
// and **bold** runs. Nothing else, on purpose.
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i}>
          {para.split("**").map((chunk, j) => (j % 2 === 1 ? <b key={j}>{chunk}</b> : chunk))}
        </p>
      ))}
    </>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className={v4.eyebrow}>{children}</p>;
}

export default async function GrovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await getGrove(id.toLowerCase());
  if (!g) notFound();

  const feePct = g.feeBps / 100;
  const excludedFromBacktest = g.backtest?.excluded ?? [];
  // In preview each name is placed as its own order, so the SMALLEST weighted
  // slice must clear the venue floor — the same formula chat enforces.
  const previewMin = grovePreviewMinUsd(g);
  const minSlicePct = Math.min(...g.components.map((c) => c.weightBps)) / 100;

  return (
    <div className={`site ${v4.root} ${shell.shell}`} data-mode="dark">
      <SiteNavV4 />
      <main className={s.main}>
        <Link href="/groves" className={s.backLink}>
          ← All groves
        </Link>

        {/* ── header ── */}
        <header className={s.head}>
          <div className={s.headMeta}>
            <span className={s.ticker}>{g.ticker}</span>
            <span className={s.chip}>{g.category}</span>
            {!g.stats.deployed && <span className={s.soon}>Opens soon</span>}
          </div>
          <h1 className={`${v4.display} ${s.h1}`}>{g.name}</h1>
          <p className={s.lead}>{g.longThesis}</p>
          <div className={s.ctas}>
            <Link href={`/app?grove=${g.id}`} className={v4.cta}>
              Buy with Vera <Arrow />
            </Link>
            <Link href={`/app?grove=${g.id}&auto=1`} className={v4.ghost}>
              Enable auto-manage
            </Link>
          </div>
        </header>

        {/* ── stats band ── */}
        <section className={`${v4.glass} ${s.statsBand}`} aria-label="Grove stats">
          <div className={s.bandStat}>
            <span className={s.bandLbl}>Investors</span>
            <span className={s.bandVal}>{g.stats.users.toLocaleString("en-US")}</span>
            <span className={s.bandSub}>open positions</span>
          </div>
          <div className={s.bandStat}>
            <span className={s.bandLbl}>Managed</span>
            <span className={s.bandVal}>{usdWhole(g.stats.managedUsd)}</span>
            <span className={s.bandSub}>USDG cost basis, on-chain</span>
          </div>
          <div className={s.bandStat}>
            <span className={s.bandLbl}>Fees paid, ever</span>
            <span className={s.bandVal}>{usdWhole(g.stats.feesUsd)}</span>
            <span className={s.bandSub}>10% of realized profit only</span>
          </div>
          <div className={s.bandStat}>
            <span className={s.bandLbl}>1y backtest vs SPY</span>
            <span className={s.bandVal}>
              {g.backtest ? (
                <>
                  <b>{pctLabel(g.backtest.portfolio.returnPct)}</b> /{" "}
                  {pctLabel(g.backtest.benchmark.returnPct)}
                </>
              ) : (
                "—"
              )}
            </span>
            <span className={s.bandSub}>history, not a promise</span>
          </div>
        </section>
        {!g.stats.deployed && (
          <p className={s.previewNote}>
            <b>This grove has not opened yet.</b> The zeros above are honest: the counters read
            straight from the GroveManager contract, so they are public and on-chain from day
            one — no dashboard math, no adjustments.
          </p>
        )}

        {/* ── composition ── */}
        <section className={s.section} aria-labelledby="composition">
          <Eyebrow>Composition</Eyebrow>
          <h2 id="composition" className={s.sectionTitle}>
            {g.components.length} holdings, every weight public
          </h2>
          <p className={s.sectionLede}>
            Real tokenized stocks, bought into your own wallet at these target weights. Prices
            are live from the same feeds the app trades on.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col" className={s.numHead}>
                    Weight
                  </th>
                  <th scope="col" className={s.numHead}>
                    Price
                  </th>
                  <th scope="col">Why it&apos;s here</th>
                </tr>
              </thead>
              <tbody>
                {g.components.map((c) => (
                  <tr key={c.symbol}>
                    <td>
                      <span className={s.company}>
                        <TokenLogo symbol={c.symbol} name={c.name} size={30} />
                        <span>
                          <span className={s.symbol}>{c.symbol}</span>
                          <span className={s.coName}>{c.name}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${s.num} ${s.weightCell}`}>{c.weightBps / 100}%</td>
                    <td className={s.num}>{c.priceUsd != null ? usd(c.priceUsd) : "—"}</td>
                    <td className={s.reason}>{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── performance ── */}
        <section className={s.section} aria-labelledby="performance">
          <Eyebrow>Performance</Eyebrow>
          <h2 id="performance" className={s.sectionTitle}>
            One year, replayed honestly
          </h2>
          <p className={s.sectionLede}>
            The basket at today&apos;s weights, simulated over the last twelve months of real
            market data with monthly rebalancing, against buy-and-hold S&amp;P 500 (dashed).
          </p>
          {g.backtest ? (
            <>
              <div className={`${v4.glass} ${s.curveCard}`}>
                <GroveCurve bt={g.backtest} />
                <div className={s.perfStats}>
                  <div className={s.perfStat}>
                    <div className={s.perfLbl}>{g.name} · 1y</div>
                    <div className={`${s.perfVal} ${s.perfAccent}`}>
                      {pctLabel(g.backtest.portfolio.returnPct)}
                    </div>
                  </div>
                  <div className={s.perfStat}>
                    <div className={s.perfLbl}>S&amp;P 500 · same year</div>
                    <div className={s.perfVal}>{pctLabel(g.backtest.benchmark.returnPct)}</div>
                  </div>
                  <div className={s.perfStat}>
                    <div className={s.perfLbl}>Worst dip</div>
                    <div className={s.perfVal}>
                      −{g.backtest.portfolio.maxDrawdownPct.toFixed(1)}%
                    </div>
                  </div>
                  <div className={s.perfStat}>
                    <div className={s.perfLbl}>Sharpe</div>
                    <div className={s.perfVal}>{g.backtest.portfolio.sharpe.toFixed(2)}</div>
                  </div>
                </div>
              </div>
              <p className={s.honesty}>
                Backtests are history, not promises.
                {g.backtest.coveragePct < 100 && (
                  <>
                    {" "}
                    This one covers {g.backtest.coveragePct}% of the basket&apos;s weight
                    {excludedFromBacktest.length > 0 && (
                      <> — {excludedFromBacktest.join(", ")} had no honest public price history,
                      so they were left out of the simulation rather than faked</>
                    )}
                    .
                  </>
                )}
              </p>
            </>
          ) : (
            <p className={s.honesty}>
              No backtest to show right now — market history for this basket could not be
              loaded. We publish nothing rather than an estimate.
            </p>
          )}
        </section>

        {/* ── methodology ── */}
        <section className={s.section} aria-labelledby="methodology">
          <Eyebrow>Methodology</Eyebrow>
          <h2 id="methodology" className={s.sectionTitle}>
            How this basket is built
          </h2>
          {g.id === "tayyib" && (
            <div className={s.callout}>
              <b>Screened, not certified.</b> Every name passes our AAOIFI sector and ratio
              screens, and every exclusion is published below with its reason. Formal
              certification is in progress — until it lands, we will not use the word. A
              per-holding impure-income estimate is published so holders can purify that
              sliver.
            </div>
          )}
          <div className={s.method}>
            <Rich text={g.methodology} />
          </div>
        </section>

        {/* ── exclusions ── */}
        {g.excluded && g.excluded.length > 0 && (
          <section className={s.section} aria-labelledby="excluded">
            <Eyebrow>Excluded</Eyebrow>
            <h2 id="excluded" className={s.sectionTitle}>
              What&apos;s not in, and why
            </h2>
            <p className={s.sectionLede}>
              Names screened out or not yet buyable on-chain, published instead of silently
              dropped.
            </p>
            <ul className={s.exclList}>
              {g.excluded.map((e) => (
                <li key={e.symbol} className={s.exclItem}>
                  <span className={s.exclSym}>{e.symbol}</span>
                  <span className={s.exclWhy}>{e.why}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── fees & mechanics ── */}
        <section className={s.section} aria-labelledby="fees">
          <Eyebrow>Fees &amp; mechanics</Eyebrow>
          <h2 id="fees" className={s.sectionTitle}>
            Every fee, including the zeros
          </h2>
          <div className={s.feeTable}>
            <div className={s.feeRow}>
              <span className={s.feeName}>Entry fee</span>
              <span className={`${s.feeVal} ${s.feeZero}`}>$0</span>
            </div>
            <div className={s.feeRow}>
              <span className={s.feeName}>Management fee</span>
              <span className={`${s.feeVal} ${s.feeZero}`}>$0</span>
            </div>
            <div className={s.feeRow}>
              <span className={s.feeName}>Rebalancing fee</span>
              <span className={`${s.feeVal} ${s.feeZero}`}>$0</span>
            </div>
            <div className={s.feeRow}>
              <span className={s.feeName}>
                Network fees
                <small>Transactions are sponsored — the network cost is on us.</small>
              </span>
              <span className={`${s.feeVal} ${s.feeZero}`}>$0</span>
            </div>
            <div className={s.feeRow}>
              <span className={s.feeName}>
                Exit fee
                <small>
                  Charged only on profit above your own cost basis, only when you exit through
                  the app. Exit flat or at a loss and it is $0.
                </small>
              </span>
              <span className={s.feeVal}>{feePct}% of profit</span>
            </div>
          </div>
          <ul className={s.mechanics}>
            <li className={s.mechItem}>
              <span className={s.mechDot} aria-hidden />
              <span>
                <b>Your own high-water mark.</b> The contract tracks your cost basis per
                wallet, on-chain. The {feePct}% applies only to gains above everything you put
                in — never to your principal, and never twice on the same gain.
              </span>
            </li>
            <li className={s.mechItem}>
              <span className={s.mechDot} aria-hidden />
              <span>
                <b>Venue spread is real and visible.</b> Each leg fills at a live on-chain
                venue quote, and quotes carry the venue&apos;s spread. That spread goes to the
                market, not to Monvera — the price you see at confirm is the price you pay.
              </span>
            </li>
            <li className={s.mechItem}>
              <span className={s.mechDot} aria-hidden />
              <span>
                <b>Your wallet holds every share.</b> Monvera never takes custody. There is no
                wrapper token and no pooled fund — you can see, move, or sell your holdings
                like any other asset you own.
              </span>
            </li>
            <li className={s.mechItem}>
              <span className={s.mechDot} aria-hidden />
              <span>
                {!g.stats.deployed && previewMin > g.minBuyUsd ? (
                  <>
                    <b>Minimum buy: {usdWhole(previewMin)} for now.</b> Until this grove&apos;s
                    contract opens, each of the {g.components.length} names is placed as its
                    own order, and the smallest slice ({minSlicePct}%) must clear the
                    venue&apos;s ~${MIN_LEG_USD} floor. At launch the minimum drops to the
                    published {usdWhole(g.minBuyUsd)}.
                  </>
                ) : (
                  <>
                    <b>Minimum buy: {usdWhole(g.minBuyUsd)}.</b> Each of the{" "}
                    {g.components.length} legs must clear the venue&apos;s ~${MIN_LEG_USD}{" "}
                    floor, so smaller buys cannot fill the whole basket.
                  </>
                )}
              </span>
            </li>
          </ul>
          <p className={s.rebalanceLine}>
            <b>Rebalancing:</b> Vera checks hourly and trades only when needed — this grove is{" "}
            {g.rebalancePolicy}. Every action lands on-chain, where anyone can verify it.
          </p>
        </section>
      </main>
      <SiteFooterV4 />
    </div>
  );
}
