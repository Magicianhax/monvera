import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GROVES, groveById, fullDiversificationUsd, RECOMMENDED_BUY_USD } from "@/lib/groves";
import { getGrove } from "@/lib/server/groveService";
import type { BacktestResult } from "@/lib/server/quant";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { Arrow, SiteFooterV4, SiteNavV4 } from "@/components/site/SiteChromeV4";
import { pctLabel } from "@/components/site/StrategyCurve";
import { displayFor } from "@/lib/displayAssets";
import { usd, usdWhole } from "@/lib/format";
import v4 from "@/components/site/SiteLandingV4.module.css";
import shell from "../groves.module.css";
import s from "./grove.module.css";

// One Grove, at full density — public and world-readable (buying happens in
// the app). Same live layer as /api/groves/[id]; revalidates every 5 minutes.
// Laid out like the in-app GroveDetailView: identity → CTAs → stat strip →
// ledger → performance → fees → mechanics — panels and rows, not prose.
export const revalidate = 300;

// GroveManager address for the facts footer — read the env var directly:
// lib/groveManager is a "use client" module, so importing its GROVE_MANAGER
// export into this server component yields a client-reference proxy, not the
// string (it 500'd the page). Empty while the contract is not deployed.
const GROVE_MANAGER = process.env.NEXT_PUBLIC_GROVE_MANAGER || "";

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
  const meta = pageMeta({
    title: `${def.ticker} — ${def.name}`,
    description: def.thesis,
    path: `/groves/${def.id}`,
  });
  // The grove's own cover art beats the generic brand card in link previews.
  if (def.coverImage) {
    meta.openGraph = { ...meta.openGraph, images: [def.coverImage] };
    meta.twitter = { ...meta.twitter, images: [def.coverImage] };
  }
  return meta;
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

export default async function GrovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await getGrove(id.toLowerCase());
  if (!g) notFound();

  const feePct = g.feeBps / 100;
  const excludedFromBacktest = g.backtest?.excluded ?? [];
  // Small buys concentrate into the largest holdings (groveLegsFor); from this
  // amount every name clears OUR per-leg gas floor at its published weight —
  // the floor is Monvera's gas economics, never a venue minimum (no venue has one).
  const fullUsd = fullDiversificationUsd(g);
  const byWeight = [...g.components].sort((a, b) => b.weightBps - a.weightBps);
  const topFive = byWeight.slice(0, 5);
  const restCount = g.components.length - topFive.length;
  const btUp = (g.backtest?.portfolio.returnPct ?? 0) >= 0;

  return (
    <div className={`site ${v4.root} ${shell.shell}`} data-mode="dark">
      <SiteNavV4 />
      <main className={s.main}>
        <Link href="/groves" className={s.backLink}>
          ← All groves
        </Link>

        {/* ── identity — naked on the background, like the app's header ── */}
        <header className={s.head}>
          <div className={s.chipRow}>
            <span className={s.stack} aria-label={`Top holdings: ${topFive.map((c) => c.symbol).join(", ")}`}>
              {topFive.map((c) => (
                <span key={c.symbol} className={s.ring}>
                  <TokenLogo symbol={c.symbol} name={c.name} size={22} />
                </span>
              ))}
            </span>
            {restCount > 0 && <span className={s.morePill}>+{restCount}</span>}
            <span className={s.ticker}>{g.ticker}</span>
            <span className={s.chip}>{g.category}</span>
            {!g.stats.deployed && <span className={s.soon}>Opens soon</span>}
          </div>
          <h1 className={`${v4.display} ${s.h1}`}>{g.name}</h1>
          <p className={s.thesis}>{g.thesis}</p>
          {/* This page is read-only — the buy happens in the app. */}
          <div className={s.ctas}>
            <Link href={`/app?grove=${g.id}`} className={v4.cta}>
              Buy in the app <Arrow />
            </Link>
            <Link href={`/app?grove=${g.id}&auto=1`} className={v4.ghost}>
              Enable auto-manage
            </Link>
          </div>
          {/* No slogan line for live groves — the numbers below speak. Only a
              not-yet-open grove needs a status note here. */}
          {!g.stats.deployed && (
            <p className={s.factLine}>
              Buys open when the contract is live — composition and rules already public
            </p>
          )}
        </header>

        {/* ── stat strip — five cells, one row, scrolls before it wraps ── */}
        <section className={`${v4.glass} ${s.statPanel}`} aria-label="Grove stats">
          <div className={s.statStrip}>
            <div className={s.cell}>
              <span className={s.microLbl}>From</span>
              <span className={s.cellSerif}>{usdWhole(g.minBuyUsd)}</span>
              <span className={s.cellSub}>
                all {g.components.length} names, every buy
              </span>
            </div>
            <div className={s.cell}>
              <span className={s.microLbl}>Total invested</span>
              <span className={s.cellVal}>{usdWhole(g.stats.managedUsd)}</span>
              <span className={s.cellSub}>cost basis, all holders</span>
            </div>
            <div className={s.cell}>
              <span className={s.microLbl}>Investors</span>
              <span className={s.cellVal}>{g.stats.users.toLocaleString("en-US")}</span>
              <span className={s.cellSub}>open positions</span>
            </div>
            <div className={s.cell}>
              <span className={s.microLbl}>Fees paid so far</span>
              <span className={s.cellVal}>{usdWhole(g.stats.feesUsd)}</span>
              <span className={s.cellSub}>{feePct}% of realized profit only</span>
            </div>
            <div className={s.cell}>
              <span className={s.microLbl}>1y vs S&amp;P</span>
              <span className={`${s.cellVal} ${btUp ? s.pos : s.neg}`}>
                {g.backtest ? pctLabel(g.backtest.portfolio.returnPct) : "—"}
              </span>
              <span className={s.cellSub}>
                {g.backtest ? `S&P ${pctLabel(g.backtest.benchmark.returnPct)} · ` : ""}
                history, not a promise
              </span>
            </div>
          </div>
        </section>
        {!g.stats.deployed && (
          <p className={s.zeroNote}>
            Not open yet — the zeros read straight from the GroveManager contract from day one.
          </p>
        )}

        {/* ── what's inside — the ledger, weights first ── */}
        <section className={`${v4.glass} ${s.panel}`} aria-labelledby="composition">
          <div className={s.panelHead}>
            <h2 id="composition" className={s.panelTitle}>
              What&apos;s inside
            </h2>
            <span className={s.panelCap}>{g.components.length} names · fixed weights</span>
          </div>
          {/* weights are in the table — the bar is a shape, not data */}
          <div className={s.allocBar} aria-hidden>
            {byWeight.map((c) => (
              <span
                key={c.symbol}
                className={s.slice}
                style={{ width: `${c.weightBps / 100}%`, background: displayFor(c.symbol, c.name).color }}
              />
            ))}
          </div>
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
                  <th scope="col" className={s.reasonCol}>
                    Why it&apos;s here
                  </th>
                </tr>
              </thead>
              <tbody>
                {byWeight.map((c) => (
                  <tr key={c.symbol}>
                    <td>
                      <span className={s.company}>
                        <TokenLogo symbol={c.symbol} name={c.name} size={26} />
                        <span>
                          <span className={s.symbol}>{c.symbol}</span>
                          <span className={s.coName}>{c.name}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${s.num} ${s.weightCell}`}>{c.weightBps / 100}%</td>
                    <td className={s.num}>{c.priceUsd != null ? usd(c.priceUsd) : "—"}</td>
                    <td className={s.reasonCol}>
                      <span className={s.reasonClamp}>{c.reason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── performance — the curve plus four numbers, one honesty line ── */}
        <section className={`${v4.glass} ${s.panel}`} aria-labelledby="performance">
          <div className={s.panelHead}>
            <h2 id="performance" className={s.panelTitle}>
              Performance
            </h2>
            <span className={s.panelCap}>1y, replayed at today&apos;s weights</span>
          </div>
          {g.backtest ? (
            <>
              <div className={s.curveWrap}>
                <GroveCurve bt={g.backtest} height={140} />
              </div>
              <div className={s.perfRow}>
                <div className={s.perfCell}>
                  <span className={s.microLbl}>{g.ticker} · 1y</span>
                  <span className={`${s.perfVal} ${btUp ? s.pos : s.neg}`}>
                    {pctLabel(g.backtest.portfolio.returnPct)}
                  </span>
                </div>
                <div className={s.perfCell}>
                  <span className={s.microLbl}>S&amp;P 500 · same yr</span>
                  <span className={s.perfVal}>{pctLabel(g.backtest.benchmark.returnPct)}</span>
                </div>
                <div className={s.perfCell}>
                  <span className={s.microLbl}>Worst dip</span>
                  <span className={s.perfVal}>−{g.backtest.portfolio.maxDrawdownPct.toFixed(1)}%</span>
                </div>
                <div className={s.perfCell}>
                  <span className={s.microLbl}>Sharpe</span>
                  <span className={s.perfVal}>{g.backtest.portfolio.sharpe.toFixed(2)}</span>
                </div>
              </div>
              <p className={s.caption}>
                Backtests are history, not promises
                {g.backtest.coveragePct < 100 && (
                  <>
                    {" "}
                    · covers {g.backtest.coveragePct}% of the basket&apos;s weight
                    {excludedFromBacktest.length > 0 && (
                      <>
                        {" "}
                        — {excludedFromBacktest.join(", ")}{" "}
                        had no honest price history, so left out rather than faked
                      </>
                    )}
                  </>
                )}
                .
              </p>
            </>
          ) : (
            <p className={s.caption}>
              No backtest to show — market history could not be loaded, and we publish nothing
              rather than an estimate.
            </p>
          )}
        </section>

        {/* ── every fee, including the zeros — the compact table IS the pitch ── */}
        <section className={`${v4.glass} ${s.panel}`} aria-labelledby="fees">
          <div className={s.panelHead}>
            <h2 id="fees" className={s.panelTitle}>
              Every fee, including the zeros
            </h2>
          </div>
          <div className={s.factRows}>
            <div className={s.factRow}>
              <span className={s.factKey}>Entry</span>
              <span className={`${s.factVal} ${s.zero}`}>$0</span>
            </div>
            <div className={s.factRow}>
              <span className={s.factKey}>Management</span>
              <span className={`${s.factVal} ${s.zero}`}>$0</span>
            </div>
            <div className={s.factRow}>
              <span className={s.factKey}>Rebalancing</span>
              <span className={`${s.factVal} ${s.zero}`}>$0</span>
            </div>
            <div className={s.factRow}>
              <span className={s.factKey}>
                Network fees
                <small>every transaction sponsored — gas is on us</small>
              </span>
              <span className={`${s.factVal} ${s.zero}`}>$0</span>
            </div>
            <div className={s.factRow}>
              <span className={s.factKey}>
                Exit in profit
                <small>only above your own cost basis · flat or at a loss: $0</small>
              </span>
              <span className={`${s.factVal} ${s.strong}`}>{feePct}% of profit</span>
            </div>
          </div>
        </section>

        {/* ── mechanics — five short rows, two lines max each ── */}
        <section className={`${v4.glass} ${s.panel}`} aria-labelledby="mechanics">
          <div className={s.panelHead}>
            <h2 id="mechanics" className={s.panelTitle}>
              How it works
            </h2>
          </div>
          <div className={s.mechRows}>
            <p className={s.mechRow}>
              <b>Custody:</b> your own wallet holds every share, with no wrapper token and no
              pooled fund. Management is a permission you grant at deposit and can revoke
              instantly; every move it makes is a public transaction, price-checked on-chain.
            </p>
            <p className={s.mechRow}>
              <b>Fee basis:</b> your own cost, per wallet, on-chain — the {feePct}% applies only
              above it, never to principal, never twice on the same gain.
            </p>
            {/* the "never call trading free" guard — venue spread is always real */}
            <p className={s.mechRow}>
              <b>Venue spread:</b> priced into every quote you approve — paid to the market,
              not to Monvera.
            </p>
            {/* The minimum is derived: it is the amount at which the SMALLEST
                published weight is still worth its own swap, so no buy above it
                ever drops a name. The {" "} after each expression is
                load-bearing: SWC drops a multi-line text node's leading space
                after an expression. */}
            <p className={s.mechRow}>
              <b>Every buy, the whole basket:</b> the {usdWhole(fullUsd)}{" "}
              minimum is set so the smallest weight is still worth buying, so every holder owns all{" "}
              {g.components.length} names at the published weights whatever they put in
              {RECOMMENDED_BUY_USD > fullUsd ? (
                <>; {usdWhole(RECOMMENDED_BUY_USD)}+ keeps trading costs a small share.</>
              ) : (
                <> and trading costs stay a small share.</>
              )}
            </p>
            <p className={s.mechRow}>
              <b>Rebalancing:</b> {g.rebalancePolicy}.
            </p>
          </div>
        </section>

        {/* ── methodology — the one prose zone, kept short ── */}
        <section className={`${v4.glass} ${s.panel}`} aria-labelledby="methodology">
          <div className={s.panelHead}>
            <h2 id="methodology" className={s.panelTitle}>
              How this basket is built
            </h2>
          </div>
          {g.id === "tayyib" && (
            <div className={s.callout}>
              <b>Screened, not certified.</b> Every name passes our AAOIFI sector and ratio
              screens; every exclusion is published with its reason. Formal certification is in
              progress — until it lands, we won&apos;t use the word. A per-holding impure-income
              estimate is published so holders can purify that sliver.
            </div>
          )}
          <div className={s.method}>
            <p>{g.longThesis}</p>
            <Rich text={g.methodology} />
          </div>
        </section>

        {/* ── exclusions — published instead of silently dropped ── */}
        {g.excluded && g.excluded.length > 0 && (
          <section className={`${v4.glass} ${s.panel}`} aria-labelledby="excluded">
            <div className={s.panelHead}>
              <h2 id="excluded" className={s.panelTitle}>
                What&apos;s not in, and why
              </h2>
              <span className={s.panelCap}>published, not silently dropped</span>
            </div>
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

        {/* ── mono facts footer — chain facts, nothing promotional ── */}
        <p className={s.monoFoot}>
          {GROVE_MANAGER && (
            <a
              className={s.footLink}
              href={`https://robinhoodchain.blockscout.com/address/${GROVE_MANAGER}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              contract {GROVE_MANAGER.slice(0, 6)}…{GROVE_MANAGER.slice(-4)} ↗
            </a>
          )}
          <span>composition changes wait 48h on-chain</span>
          <span>non-custodial — only your wallet moves the basket</span>
        </p>
      </main>
      <SiteFooterV4 />
    </div>
  );
}
