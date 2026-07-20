"use client";

// SiteLandingV4 — "Deep Emerald Trading Floor".
// The marketing site as one committed dark-green room built entirely from the
// app's official tokens: Fraunces serif for command, JetBrains mono for the
// programmatic voice, the liquid-glass material for every object, and the real
// brand marks + real Arcus stock logos as the only imagery. The hero object is
// the product itself: one Vera exchange, rendered as UI. A single cream
// "paper" section carries the on-chain receipt — the light half of the brand.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VeraOrb } from "@/components/design/Brand";
import { GroveCover } from "@/components/GroveCover";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { displayFor } from "@/lib/displayAssets";
import { usdWhole } from "@/lib/format";
import { assetBySymbol } from "@/lib/tokens";
import { pctLabel } from "./StrategyCurve";
import {
  Arrow,
  DEX_URL,
  DOCS_URL,
  External,
  SiteFooterV4,
  SiteNavV4,
  TOKEN_CA,
  TOKEN_EXPLORER_URL,
  VERA_CONTRACT_URL,
  VIRTUALS_URL,
} from "./SiteChromeV4";
import s from "./SiteLandingV4.module.css";

export interface VeraStatsV4 {
  plans: number;
  invested: number;
  placed: number;
  latest: { label: string; usdc: number | null; txUrl: string } | null;
}

// Compact server-fed teaser for the Groves section — same live layer as
// /groves, trimmed to what the landing cards actually show.
export interface GroveTeaserV4 {
  id: string;
  ticker: string;
  name: string;
  category: string;
  thesis: string;
  coverImage?: string;
  backtestPct: number | null;
  benchPct: number | null;
  minBuyUsd: number;
  deployed: boolean;
  topHoldings: { symbol: string; name: string }[];
  moreCount: number;
}

// The hero exchange: seven legs, $30 each — every leg over the $11 venue
// minimum, exactly what Vera would actually plan for this ask.
const M7: ReadonlyArray<[string, number]> = [
  ["AAPL", 30],
  ["MSFT", 30],
  ["NVDA", 30],
  ["AMZN", 30],
  ["GOOGL", 30],
  ["META", 30],
  ["TSLA", 30],
];

// Shelf order: recognizable names first, verified against the live asset book
// at module scope so a renamed ticker can never render an empty chip.
const SHELF_WISHLIST = [
  "AAPL", "NVDA", "MSFT", "TSLA", "SPY", "AMZN", "GOOGL", "META", "QQQ", "AVGO",
  "PLTR", "AMD", "COIN", "HOOD", "NFLX", "ORCL", "MSTR", "CRCL", "CRWV", "BABA",
  "COST", "ASML", "IWM", "GLD", "UNH", "BA", "GME", "SOFI",
];
const SHELF = SHELF_WISHLIST.filter((sym) => assetBySymbol(sym));

const SAY_CARDS = [
  {
    cmd: "“Put $200 into AI — spread it out.”",
    body: "Vera builds the basket, prices every leg across the venues, and shows the full plan — every stock, every dollar — before anything moves.",
    tag: "Invest",
  },
  {
    cmd: "“Review my portfolio. What should I sell?”",
    body: "She reads your actual holdings — what moved, what you paid, what it's worth — and gives you a straight answer. Selling is one confirmation away.",
    tag: "Review & sell",
  },
  {
    cmd: "“Alert me if NVDA drops 5%.”",
    body: "Price alerts, weekly digests, and a recurring autopilot — set any of it in one sentence, change it the same way. Your inbox lives in the chat.",
    tag: "Automate",
  },
];

const TRUTHS = [
  { b: "You hold the keys.", rest: " Stocks settle to your own wallet. Vera can never touch them." },
  { b: "Nothing trades without your confirmation.", rest: " Every plan is shown in full first — then you tap once." },
  { b: "Zero commission, no gas.", rest: " We earn a small routing referral from the venues. That's the whole business." },
  { b: "Backtests are history, not promises.", rest: " Stocks go down as well as up." },
];

function money(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// The official Robinhood feather (simple-icons path), drawn in the eyebrow's
// own green so the mark reads as part of the line, not a pasted asset.
function RobinhoodMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852" />
    </svg>
  );
}

// Real stock logo chip with the same monogram fallback the app uses.
function StockLogo({ symbol, className, monoClass }: { symbol: string; className: string; monoClass: string }) {
  const d = displayFor(symbol);
  const [failed, setFailed] = useState(false);
  if (!d.logo || failed) {
    return (
      <span className={monoClass} style={{ background: d.color }} aria-hidden="true">
        {(d.glyph || symbol[0]).toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={d.logo} alt="" className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function SiteLandingV4({
  veraStats,
  groves = [],
}: {
  veraStats: VeraStatsV4;
  groves?: GroveTeaserV4[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Reveal choreography: hide-then-show only once JS is live (data-js), so
  // no-JS visitors and crawlers get the finished page straight from SSR.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.setAttribute("data-js", "true");
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-rv]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).setAttribute("data-in", "true");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const { plans, invested, latest } = veraStats;
  const shelfRow = [...SHELF, ...SHELF];

  return (
    <div ref={rootRef} className={s.root}>
      <SiteNavV4 />

      {/* ── hero: the emerald room ── */}
      <section className={s.hero}>
        <div className={`${s.wrap} ${s.heroGrid}`}>
          <div>
            <Link href="/groves" className={s.heroPill}>
              <span className={s.heroPillTag}>New</span>
              Groves &mdash; curated stock baskets, from $20
              <Arrow />
            </Link>
            <p className={`${s.eyebrow} ${s.heroEyebrow}`}>
              The AI broker on
              <RobinhoodMark />
              Robinhood Chain
            </p>
            <h1 className={`${s.display} ${s.h1}`}>
              Say it.
              <br />
              <em>Own it.</em>
            </h1>
            <p className={`${s.lede} ${s.heroLede}`}>
              Vera is an AI broker for real tokenized stocks. Tell her what you want in plain
              words &mdash; she prices it across 95 assets, shows every dollar before it moves,
              and settles to a wallet only you hold.
            </p>
            <div className={s.heroCtas}>
              <Link href="/app" className={s.cta}>
                Start with $20 <Arrow />
              </Link>
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={s.ghost}>
                Read the docs
              </a>
            </div>
            <div className={s.heroFoot}>
              <div className={s.stat}>
                <span className={s.statNum}>
                  <b>{plans.toLocaleString("en-US")}</b> plans
                </span>
                <span className={s.statLbl}>committed on-chain by Vera</span>
              </div>
              <div className={s.stat}>
                <span className={s.statNum}>
                  <b>{money(invested)}</b> executed
                </span>
                <span className={s.statLbl}>through signed allocations</span>
              </div>
              <div className={s.stat}>
                <span className={s.statNum}>
                  <b>95</b> assets
                </span>
                <span className={s.statLbl}>real stocks &amp; ETFs, on-chain</span>
              </div>
            </div>
          </div>

          {/* the product, rendered as itself */}
          <div className={s.ticket} aria-label="Example conversation with Vera">
            <span className={s.ticketGlow} aria-hidden="true" />
            <div className={s.userMsg}>Put $210 into the Magnificent 7</div>
            <div className={s.veraRow}>
              <VeraOrb size={34} pulse />
              <div className={`${s.glass} ${s.veraCard}`}>
                <p className={s.veraSays}>
                  Here&rsquo;s the plan &mdash; <b>7 stocks, $30 each</b>. Nothing moves until
                  you confirm.
                </p>
                {M7.map(([sym, amt]) => {
                  const d = displayFor(sym);
                  return (
                    <div key={sym} className={s.leg}>
                      <StockLogo symbol={sym} className={s.legLogo} monoClass={s.legMono} />
                      <span className={s.legSym}>{sym}</span>
                      <span className={s.legName}>{d.name}</span>
                      <span className={s.legAmt}>${amt}</span>
                    </div>
                  );
                })}
                <div className={s.ticketFoot}>
                  <span className={s.onchain}>
                    <span className={s.tickCircle}>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M1.5 5.5 4 8l4.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    Recorded on-chain
                  </span>
                  <span className={s.ticketTotal}>$210.00</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── the shelf: the real book ── */}
      <section className={s.shelf} aria-label="Tradable assets">
        <span className={s.shelfLabel}>The shelf &middot; 95 real assets</span>
        <div className={s.marquee}>
          <div className={s.marqueeTrack}>
            {shelfRow.map((sym, i) => {
              const d = displayFor(sym);
              return (
                <span key={`${sym}-${i}`} className={s.tick} aria-hidden={i >= SHELF.length}>
                  <StockLogo symbol={sym} className={s.tickLogo} monoClass={s.tickMono} />
                  <span className={s.tickSym}>{sym}</span>
                  <span className={s.tickName}>{d.name}</span>
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Groves: the flagship — curated baskets of the shelf above ── */}
      {groves.length > 0 && (
        <section className={s.groves} aria-label="Monvera Groves">
          <div className={s.wrap}>
            <div className={`${s.grovesHead} ${s.rv}`} data-rv>
              <p className={s.eyebrow}>New &middot; Monvera Groves</p>
              <h2 className={`${s.display} ${s.h2}`}>
                Strategies you own, <em>not funds you buy.</em>
              </h2>
              <p className={`${s.lede} ${s.grovesLede}`}>
                A Grove is a curated basket of real tokenized stocks that Vera buys straight
                into your own wallet and manages in the open &mdash; composition, backtests,
                and every trade published, non-custodial from the first share.
              </p>
              <p className={`${s.grovesFee} ${s.mono}`}>
                $0 entry &middot; $0 management &middot; 10% of profit, only at exit
              </p>
            </div>
            <div className={s.grovesGrid}>
              {groves.map((g, i) => (
                <Link
                  key={g.id}
                  href={`/groves/${g.id}`}
                  className={`${s.glass} ${s.gCard} ${s.rv}`}
                  data-rv
                  style={{ transitionDelay: `${i * 80}ms` }}
                >
                  <span className={s.gCover}>
                    <GroveCover id={g.id} coverImage={g.coverImage} />
                    {!g.deployed && <span className={s.gSoon}>Opens soon</span>}
                  </span>
                  <span className={s.gBody}>
                    <span className={s.gTop}>
                      <span className={`${s.gTicker} ${s.mono}`}>{g.ticker}</span>
                      <span className={s.gChip}>{g.category}</span>
                    </span>
                    <span className={s.gName}>{g.name}</span>
                    <span className={s.gThesis}>{g.thesis}</span>
                    <span
                      className={s.gLogos}
                      aria-label={`Top holdings: ${g.topHoldings.map((c) => c.symbol).join(", ")}`}
                    >
                      {g.topHoldings.map((c) => (
                        <span key={c.symbol} className={s.gRing}>
                          <TokenLogo symbol={c.symbol} name={c.name} size={26} />
                        </span>
                      ))}
                      {g.moreCount > 0 && <span className={s.gMore}>+{g.moreCount} more</span>}
                    </span>
                    <span className={s.gStats}>
                      <span className={s.gStat}>
                        <span className={s.gStatLbl}>1y backtest</span>
                        <span className={`${s.gStatVal} ${s.gAccent}`}>
                          {g.backtestPct != null ? pctLabel(g.backtestPct) : "—"}
                        </span>
                      </span>
                      <span className={s.gStat}>
                        <span className={s.gStatLbl}>S&amp;P 500 &middot; same yr</span>
                        <span className={s.gStatVal}>
                          {g.benchPct != null ? pctLabel(g.benchPct) : "—"}
                        </span>
                      </span>
                      <span className={s.gStat}>
                        <span className={s.gStatLbl}>Min buy</span>
                        <span className={s.gStatVal}>{usdWhole(g.minBuyUsd)}</span>
                      </span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            <div className={`${s.grovesCtas} ${s.rv}`} data-rv>
              <Link href="/groves" className={s.cta}>
                Explore the Groves <Arrow />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── what you can say ── */}
      <section className={s.say}>
        <div className={s.wrap}>
          <div className={`${s.sayHead} ${s.rv}`} data-rv>
            <p className={s.eyebrow}>The whole account is a conversation</p>
            <h2 className={`${s.display} ${s.h2}`}>
              If you can say it, Vera can do it.
            </h2>
          </div>
          <div className={s.sayGrid}>
            {SAY_CARDS.map((c, i) => (
              <article
                key={c.tag}
                className={`${s.glass} ${s.sayCard} ${s.rv}`}
                data-rv
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <span className={s.sayCmd}>{c.cmd}</span>
                <p className={s.sayBody}>{c.body}</p>
                <span className={s.sayTag}>{c.tag}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── the paper interlude: receipts ── */}
      <section className={s.paper}>
        <div className={`${s.wrap} ${s.paperGrid}`}>
          <div className={s.rv} data-rv>
            <p className={`${s.eyebrow} ${s.paperEyebrow}`}>Proof, not promises</p>
            <h2 className={`${s.display} ${s.h2} ${s.paperH2}`}>
              Every plan prints a public receipt.
            </h2>
            <ul className={s.truths}>
              {TRUTHS.map((t) => (
                <li key={t.b} className={s.truth}>
                  <span className={s.truthDot} aria-hidden="true" />
                  <span>
                    <b>{t.b}</b>
                    {t.rest}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className={`${s.receipt} ${s.rv}`} data-rv style={{ transitionDelay: "120ms" }}>
            <span className={s.rStamp}>On-chain</span>
            <div className={s.rHead}>Monvera &middot; plan receipt</div>
            <div className={s.rDash} />
            <div className={s.rLine}>
              <span>Plan</span>
              <b>{latest ? latest.label : "Balanced allocation"}</b>
            </div>
            <div className={s.rLine}>
              <span>Spent</span>
              <b>{latest?.usdc != null ? `$${latest.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Shown before you sign"}</b>
            </div>
            <div className={s.rLine}>
              <span>Custody</span>
              <b>Your wallet</b>
            </div>
            <div className={s.rLine}>
              <span>Commission</span>
              <b>$0.00</b>
            </div>
            <div className={s.rDash} />
            <div className={s.rLine}>
              <span>Verify</span>
              <a
                className={s.rLink}
                href={latest ? latest.txUrl : VERA_CONTRACT_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {latest ? "View transaction" : "View the contract"}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── $MONVERA ── */}
      <section className={s.token}>
        <div className={s.wrap}>
          <div className={`${s.glass} ${s.tokenCard} ${s.rv}`} data-rv>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" className={s.tokenLogo} width={62} height={62} />
            <div>
              <h2 className={s.tokenName}>$MONVERA</h2>
              <p className={s.tokenDesc}>
                The community token behind Vera, live on Robinhood Chain via Virtuals. A stake
                in the agent&rsquo;s story &mdash; not an investment product, and separate from
                the stocks Vera trades.
              </p>
              <span className={`${s.tokenCa} ${s.mono}`}>{TOKEN_CA}</span>
            </div>
            <div className={s.tokenLinks}>
              <a className={s.tokenLink} href={VIRTUALS_URL} target="_blank" rel="noopener noreferrer">
                Virtuals <External />
              </a>
              <a className={s.tokenLink} href={DEX_URL} target="_blank" rel="noopener noreferrer">
                Dexscreener <External />
              </a>
              <a className={s.tokenLink} href={TOKEN_EXPLORER_URL} target="_blank" rel="noopener noreferrer">
                Blockscout <External />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── closer ── */}
      <section className={s.closer}>
        <div className={`${s.wrap} ${s.closerInner} ${s.rv}`} data-rv>
          <span className={s.closerOrb}>
            <VeraOrb size={56} pulse />
          </span>
          <h2 className={`${s.display} ${s.closerH}`}>
            Your money, <em>spoken for.</em>
          </h2>
          <Link href="/app" className={s.cta}>
            Talk to Vera <Arrow />
          </Link>
        </div>
      </section>

      <SiteFooterV4 />
    </div>
  );
}
