"use client";

// Monvera marketing landing (route "/"). A complete rebuild: warm, calm,
// green-anchored consumer-fintech, product-forward (the real app is the hero),
// with an orchestrated GSAP motion layer (hero entrance timeline, scroll-driven
// reveals, count-ups, a typed goal->plan beat, a drifting logo field, nav
// hide-on-scroll, and hero parallax). All motion runs client-only via useGSAP
// with a prefers-reduced-motion guard; nothing hides content by default.
// Styles live in the committed SiteLanding.module.css (globals.css is local-only).
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sun, Moon, Menu, KeyRound, Zap, ShieldCheck, ChevronDown } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextPlugin } from "gsap/TextPlugin";
import { useGSAP } from "@gsap/react";
import { displayFor } from "@/lib/displayAssets";
import { PARTNERS } from "@/components/shared/Partners";
import { FAQ } from "@/lib/faq";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { MonveraIcon } from "@/components/design";
import { DemoMount } from "@/components/demo/DemoMount";
import type { DemoPlay } from "@/components/demo/DemoProvider";
import { PhoneChrome } from "@/components/site/PhoneChrome";
import s from "./SiteLanding.module.css";
import { asset } from "@/lib/assets";

gsap.registerPlugin(useGSAP, ScrollTrigger, TextPlugin);

type Mode = "light" | "dark";

// Hero background slideshow — famous places from countries Monvera serves, shown
// in order. Media is hosted on Cloudflare R2 (see lib/assets.ts; prompts in docs/).
const HERO_SLIDES: { file: string; place: string; mascot: string }[] = [
  { file: "hero-01-tokyo.webp", place: "Tokyo, Japan", mascot: "vera-01-tokyo.webp" },
  { file: "hero-02-tajmahal.webp", place: "Agra, India", mascot: "vera-02-tajmahal.webp" },
  { file: "hero-03-dubai.webp", place: "Dubai, UAE", mascot: "vera-03-dubai.webp" },
  { file: "hero-04-istanbul.webp", place: "Istanbul, Turkey", mascot: "vera-04-istanbul.webp" },
  { file: "hero-05-singapore.webp", place: "Singapore", mascot: "vera-05-singapore.webp" },
  { file: "hero-06-rio.webp", place: "Rio de Janeiro, Brazil", mascot: "vera-06-rio.webp" },
  { file: "hero-07-capetown.webp", place: "Cape Town, South Africa", mascot: "vera-07-capetown.webp" },
  { file: "hero-08-cairo.webp", place: "Cairo, Egypt", mascot: "vera-08-cairo.webp" },
];

const FIELD_A = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "SPY", "META"];
const FIELD_B = ["TSLA", "QQQ", "AMD", "COIN", "SGOV", "PLTR", "GOOGL"];

// Rotating goals for the typed "you say" beat.
const GOALS = [
  "Grow $300, mostly big tech, keep some safe.",
  "Put $50 into AI companies every month.",
  "Something calmer that still beats my bank.",
];

// A fixed, illustrative plan the beat "builds" (labelled as an example).
const PLAN: { sym: string; pct: number }[] = [
  { sym: "SPY", pct: 40 },
  { sym: "NVDA", pct: 22 },
  { sym: "AAPL", pct: 18 },
  { sym: "SGOV", pct: 20 },
];

const fmtPrice = (p?: number) => (p == null ? "" : p >= 1000 ? "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "$" + p.toFixed(2));

/** A real-company pill (logo + name + day move) for the drifting field. */
function StockPill({ sym }: { sym: string }) {
  const d = displayFor(sym);
  const up = d.day >= 0;
  return (
    <span className={s.pill}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {d.logo ? <img src={d.logo} alt="" loading="lazy" decoding="async" /> : null}
      <b>{d.name}</b>
      <i className={up ? s.up : s.down}>{up ? "+" : ""}{d.day.toFixed(2)}%</i>
    </span>
  );
}

/** The real app, framed as a phone. play=null mounts immediately (hero); an
 *  autoplay script lazy-mounts when scrolled near (keeps first paint light). */
function Phone({ play, mode }: { play: DemoPlay; mode: Mode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(play === null);
  useEffect(() => {
    if (show) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { setShow(true); io.disconnect(); } }),
      { rootMargin: "260px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);
  return (
    <div className="phone" ref={ref}>
      <div className="phone-screen">
        <div className="demo-embed">
          {show && <div className="demo-embed-fit"><DemoMount play={play} mode={mode} /></div>}
        </div>
        <PhoneChrome />
      </div>
    </div>
  );
}

export function SiteLanding() {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("light");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("monvera-landing-mode") ?? localStorage.getItem("stax-landing-mode");
    if (saved === "dark" || saved === "light") setMode(saved);
  }, []);

  // Pin the browser chrome (scrollbar, form controls) to the landing's mode. Without
  // this, a dark-OS visitor gets a black system scrollbar over the light page (the
  // dark strip on the right). Restore on unmount so it never leaks into /app.
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.colorScheme;
    el.style.colorScheme = mode;
    return () => { el.style.colorScheme = prev; };
  }, [mode]);

  const toggleMode = () =>
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      localStorage.setItem("monvera-landing-mode", next);
      return next;
    });

  useGSAP(
    () => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);

      // Hero background: crossfading Ken-Burns slideshow of world landmarks, with
      // the place caption synced to the active slide.
      const slides = q(".js-slide");
      const mascots = q(".js-mascot");
      const mRest = { opacity: 0 };
      if (slides.length) {
        const N = slides.length;
        const HOLD = 3.6, SLIDE = 1.2, STEP = HOLD + SLIDE;
        // A fixed frame (static overscale, never animated) so the horizontal slide
        // never reveals an edge. The ONLY motion is the slide — no zoom, no ken-burns.
        const rest = { opacity: 0, xPercent: 7, scale: 1.14 };
        gsap.set(slides, rest);
        gsap.set(slides[0], { opacity: 1, xPercent: 0 });
        gsap.set(mascots, mRest);
        gsap.set(mascots[0], { opacity: 1 });
        const stl = gsap.timeline({
          repeat: -1,
          onRepeat: () => {
            gsap.set(slides, rest); gsap.set(slides[0], { opacity: 1, xPercent: 0 });
            gsap.set(mascots, mRest); gsap.set(mascots[0], { opacity: 1 });
          },
        });
        slides.forEach((sl, i) => {
          const start = i * STEP;
          const ni = (i + 1) % N;
          // background: current slides out to the left, next slides in from the right.
          stl.to(sl, { opacity: 0, xPercent: -7, duration: SLIDE, ease: "power2.inOut" }, start + HOLD);
          stl.fromTo(slides[ni], { opacity: 0, xPercent: 7 }, { opacity: 1, xPercent: 0, duration: SLIDE, ease: "power2.inOut", immediateRender: false }, start + HOLD);
          // Vera swaps her outfit with the slide — a plain crossfade, no zoom.
          if (mascots[i]) stl.to(mascots[i], { opacity: 0, duration: SLIDE, ease: "power2.inOut" }, start + HOLD);
          if (mascots[ni]) stl.fromTo(mascots[ni], { opacity: 0 }, { opacity: 1, duration: SLIDE, ease: "power2.inOut", immediateRender: false }, start + HOLD);
        });
      }

      // Hero wordmark + Vera + tagline + CTA entrance.
      const entrance = gsap
        .timeline({ defaults: { ease: "power3.out" }, delay: 0.15 })
        .from(".js-wm", { y: 34, opacity: 0, duration: 0.9 });
      if (mascots[0]) entrance.from(mascots[0], { opacity: 0, duration: 0.7 }, "-=0.5");
      entrance
        .from(".js-hero-tag", { y: 18, opacity: 0, duration: 0.6 }, "-=0.5")
        .from(".js-hero-cta", { y: 16, opacity: 0, stagger: 0.1, duration: 0.5 }, "-=0.4");

      // Generic scroll reveals + staggered groups.
      q(".js-reveal").forEach((el) =>
        gsap.from(el, { y: 42, opacity: 0, duration: 0.85, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 84%" } }),
      );
      q(".js-stagger").forEach((group) =>
        gsap.from((group as HTMLElement).children, {
          y: 28, opacity: 0, duration: 0.6, stagger: 0.09, ease: "power3.out",
          scrollTrigger: { trigger: group, start: "top 82%" },
        }),
      );

      // Count-ups (data-count + optional prefix/suffix/dp).
      q("[data-count]").forEach((node) => {
        const el = node as HTMLElement;
        const to = parseFloat(el.dataset.count || "0");
        const dp = parseInt(el.dataset.dp || "0", 10);
        const prefix = el.dataset.prefix || "";
        const suffix = el.dataset.suffix || "";
        const obj = { v: 0 };
        gsap.to(obj, {
          v: to, duration: 1.5, ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 90%" },
          onUpdate: () => { el.textContent = prefix + obj.v.toFixed(dp) + suffix; },
        });
      });

      // The living beat: build the example plan, then loop the typed goals.
      gsap.from(".js-plan-row", { x: 18, opacity: 0, duration: 0.6, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: ".js-beat", start: "top 68%" } });
      gsap.from(".js-bar", { scaleX: 0, transformOrigin: "left", duration: 0.9, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: ".js-beat", start: "top 66%" } });
      const say = q(".js-say")[0];
      if (say) {
        const tl = gsap.timeline({ repeat: -1, scrollTrigger: { trigger: ".js-beat", start: "top 72%" } });
        GOALS.forEach((g) => {
          tl.to(say, { duration: Math.max(0.8, g.length * 0.028), text: g, ease: "none" }).to(say, { duration: 2.4 });
        });
      }

      // Drifting logo field (two rows, opposite directions, seamless via duped content).
      gsap.fromTo(".js-field-a", { xPercent: 0 }, { xPercent: -50, duration: 42, ease: "none", repeat: -1 });
      gsap.fromTo(".js-field-b", { xPercent: -50 }, { xPercent: 0, duration: 48, ease: "none", repeat: -1 });

      // Nav hide on scroll-down, show on scroll-up.
      const navY = gsap.quickTo(".js-nav", "y", { duration: 0.4, ease: "power3.out" });
      ScrollTrigger.create({
        start: 0, end: "max",
        onUpdate: (self) => navY(self.scroll() > 260 && self.direction === 1 ? -130 : 0),
      });
    },
    { scope: root },
  );

  const navLinks = (
    <>
      <a href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
      <a href="#own" onClick={() => setMenuOpen(false)}>What you own</a>
      <a href="#built" onClick={() => setMenuOpen(false)}>Built on</a>
      <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
    </>
  );

  return (
    <div className={`site ${s.root}`} data-mode={mode} ref={root}>
      <div className={`${s.aura} js-aura`} aria-hidden />

      {/* NAV — short, floating, hides on scroll */}
      <nav className={`${s.nav} js-nav`}>
        <div className={s.navInner}>
          <a className={s.brand} href="#top"><MonveraIcon size={24} /> Monvera</a>
          <div className={s.navLinks}>{navLinks}</div>
          <div className={s.navActions}>
            <button className={s.iconBtn} onClick={toggleMode} aria-label="Toggle theme">
              {mode === "dark" ? <Sun size={19} strokeWidth={1.9} /> : <Moon size={19} strokeWidth={1.9} />}
            </button>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`} href="/app">Open the app</Link>
            <button className={`${s.iconBtn} ${s.burger}`} onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
              <Menu size={20} strokeWidth={2} />
            </button>
          </div>
        </div>
        {menuOpen && <div className={s.navDrop}><div className={s.navDropPanel}>{navLinks}</div></div>}
      </nav>

      {/* HERO — full-bleed world-landmarks slideshow + wordmark. Vera the mascot
          gets layered on top later, over the centre of the wordmark. */}
      <header id="top" className={`${s.heroFull} js-hero`}>
        <div className={s.heroSlides} aria-hidden>
          {HERO_SLIDES.map((sl) => (
            <div
              key={sl.file}
              className={`${s.heroSlide} js-slide`}
              style={{ backgroundImage: `url(${asset(`/brand/hero/${sl.file}`)})` }}
            />
          ))}
        </div>
        <div className={s.heroScrim} aria-hidden />
        <div className={s.heroContent}>
          <h1 className={`${s.display} ${s.wordmark} js-wm`}>Monvera</h1>
          <p className={`${s.heroTag} js-hero-tag`}>Invest by just saying what you want.</p>
          <div className={s.heroCtasFull}>
            <Link className={`${s.btn} ${s.btnLg} ${s.btnOnDark} js-hero-cta`} href="/app">Start investing <ArrowUpRight size={18} strokeWidth={2.2} /></Link>
            <Link className={`${s.btn} ${s.btnLg} ${s.btnGhostOnDark} js-hero-cta`} href="/demo">See the live demo</Link>
          </div>
        </div>
        {/* Vera the mascot — bottom-left of the hero, changes outfit with each slide */}
        <div className={s.mascotLayer} aria-hidden>
          {HERO_SLIDES.map((sl) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={sl.mascot} className={`${s.mascot} js-mascot`} src={asset(`/brand/hero/${sl.mascot}`)} alt="" decoding="async" />
          ))}
        </div>
      </header>

      {/* BEAT — a sentence becomes a plan */}
      <section className={`${s.section} ${s.beat} js-beat`}>
        <div className={s.wrap}>
          <div className={s.beatGrid}>
            <div>
              <h2 className={`${s.display} ${s.h2}`}>A sentence, and Vera builds the rest.</h2>
              <p className={s.lead}>Say it however feels natural. Vera turns it into a real, diversified basket, sizes each holding from live market data, and explains every pick.</p>
              <div style={{ marginTop: 26 }}>
                <span className={s.sayBubble}><span className="js-say">Grow $300, mostly big tech, keep some safe.</span><span className={s.caret}>▌</span></span>
              </div>
            </div>
            <div className={s.planCard}>
              <div className={s.planHead}><span className={s.dot} /> An example plan · balanced</div>
              <div style={{ marginTop: 8 }}>
                {PLAN.map((h) => {
                  const d = displayFor(h.sym);
                  return (
                    <div key={h.sym} className={`${s.planRow} js-plan-row`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {d.logo ? <img src={d.logo} alt="" decoding="async" /> : null}
                      <span className={s.planName}>{d.name}<small>{d.cat}</small></span>
                      <span className={s.planBarTrack}><span className={`${s.planBar} js-bar`} style={{ width: `${h.pct}%` }} /></span>
                      <span className={`${s.planPct} ${s.mono}`}>{h.pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST — honest numbers + three pillars */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={s.ownHead} style={{ textAlign: "center" }}>
            <h2 className={`${s.display} ${s.h2}`}>You stay in control.</h2>
          </div>
          <div className={`${s.pillars} js-stagger`}>
            <div className={s.pillar}>
              <span className={s.pillarIco}><KeyRound size={22} strokeWidth={1.9} /></span>
              <div className={s.pillarStat}>Your <span>keys</span></div>
              <div className={s.pillarLabel}>Non-custodial</div>
              <p className={s.pillarText}>Monvera never holds your money. It lives in a wallet only you control, provable on-chain.</p>
            </div>
            <div className={s.pillar}>
              <span className={s.pillarIco}><Zap size={22} strokeWidth={1.9} /></span>
              <div className={s.pillarStat}><span data-count="0" data-prefix="$">$0</span> gas</div>
              <div className={s.pillarLabel}>Gasless, no platform fee</div>
              <p className={s.pillarText}>We cover every network fee and charge no account or platform fees. Monvera earns a small referral from the trading venue, not from you.</p>
            </div>
            <div className={s.pillar}>
              <span className={s.pillarIco}><ShieldCheck size={22} strokeWidth={1.9} /></span>
              <div className={s.pillarStat}>On the <span>record</span></div>
              <div className={s.pillarLabel}>Signed on-chain</div>
              <p className={s.pillarText}>Every plan Vera signs is written on-chain, so her track record is public and can&apos;t be edited later.</p>
            </div>
          </div>
        </div>
      </section>

      {/* OWN — real companies, real logos */}
      <section className={s.section} id="own">
        <div className={s.wrap}>
          <div className={s.ownHead}>
            <h2 className={`${s.display} ${s.h2}`}>Own real shares of <span data-count="100" data-prefix="~" style={{ color: "var(--s-primary-d)" }}>~100</span> companies and funds.</h2>
            <p className={s.lead}>Apple, Nvidia, the S&amp;P 500, US Treasuries and more, each a real share tokenized one-to-one, held by you. From a single dollar.</p>
          </div>
          <div className={s.field}>
            <div className={`${s.fieldRow} js-field-a`}>{[...FIELD_A, ...FIELD_A].map((sym, i) => <StockPill key={sym + i} sym={sym} />)}</div>
            <div className={`${s.fieldRow} js-field-b`}>{[...FIELD_B, ...FIELD_B].map((sym, i) => <StockPill key={sym + i} sym={sym} />)}</div>
          </div>
        </div>
      </section>

      {/* HOW — three steps + the real app */}
      <section className={s.section} id="how">
        <div className={s.wrap}>
          <div className={s.howGrid}>
            <div>
              <h2 className={`${s.display} ${s.h2}`}>Three taps, about two minutes.</h2>
              <ol className={`${s.steps} js-stagger`}>
                <li className={s.step}><span className={s.stepN}>1</span><div><h3>Tell Vera your goal</h3><p>Say it in plain words, like &ldquo;grow $300, mostly big tech, keep some safe.&rdquo;</p></div></li>
                <li className={s.step}><span className={s.stepN}>2</span><div><h3>Review the plan</h3><p>Named companies and funds, each with a one-line reason and a plain-language risk read. Nudge it safer or bolder.</p></div></li>
                <li className={s.step}><span className={s.stepN}>3</span><div><h3>Invest in one tap</h3><p>Vera buys every holding for you, instantly and gas-free, then records it on-chain.</p></div></li>
              </ol>
            </div>
            <div style={{ display: "grid", placeItems: "center" }}><Phone play="invest" mode={mode} /></div>
          </div>
        </div>
      </section>

      {/* BUILT ON */}
      <section className={s.section} id="built">
        <div className={s.wrap}>
          <div className="js-reveal">
            <div className={s.builton}>
              <span className={s.builtonLabel}>Built on</span>
              {PARTNERS.map((p, i) => (
                <Fragment key={p.key}>
                  {i > 0 && <span className={s.builtonDiv} aria-hidden />}
                  <a className={s.builtonLogo} href={p.href} target="_blank" rel="noreferrer" aria-label={p.name}>
                    <span style={{ display: "inline-flex", color: "var(--s-ink)" }}>{p.mark(19)}</span>
                    <b>{p.name}</b>
                  </a>
                </Fragment>
              ))}
            </div>
            <p className={s.builtonNote}>
              It settles on <b>Robinhood Chain</b>, a fast, low-cost Ethereum L2, where <b>Arcus</b> prices and routes every trade at a
              live market quote, and <b>Vera</b> runs on <b>Virtuals</b>, which gives her a verifiable on-chain identity. Each stock is
              a real share, tokenized one-to-one on Robinhood Chain, so what you own tracks the actual company.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={s.section} id="faq">
        <div className={s.wrap}>
          <div className={s.ownHead} style={{ textAlign: "center" }}>
            <h2 className={`${s.display} ${s.h2}`}>Questions you&rsquo;d actually ask.</h2>
          </div>
          <div className={`${s.faq} js-stagger`}>
            {FAQ.slice(0, 6).map((item) => (
              <details key={item.q} className={s.faqItem}>
                <summary className={s.faqSummary}>
                  <span className={s.faqQ}>{item.q}</span>
                  <span className={s.faqIco} aria-hidden><ChevronDown size={20} strokeWidth={2.2} /></span>
                </summary>
                <div className={s.faqA}><p>{item.a}</p></div>
              </details>
            ))}
          </div>
          <p style={{ textAlign: "center", marginTop: 26 }}>
            <Link href="/app" style={{ color: "var(--s-primary-d)", fontWeight: 600 }}>More answers inside the app &rarr;</Link>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={`${s.ctaCard} js-reveal`}>
            <div className={s.ctaGlow} aria-hidden />
            <h2>Your first investment is one sentence away.</h2>
            <p>Start with as little as $1. Tell Vera a goal, look over the plan she builds, and invest in one tap.</p>
            <div className={s.ctaCtas}>
              <Link className={`${s.btn} ${s.btnLg} ${s.btnOnDark}`} href="/app">Open the app <ArrowUpRight size={18} strokeWidth={2.2} /></Link>
              <a className={`${s.btn} ${s.btnLg} ${s.btnGhostOnDark}`} href="#how">How it works</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={s.wrap}>
          <div className={s.footerGrid}>
            <div className={s.footerBrand}>
              <a className={s.brand} href="#top"><MonveraIcon size={26} /> Monvera</a>
              <p>Investing in plain words. Real companies, real shares, an assistant whose record you can verify.</p>
            </div>
            <div className={s.footerCol}>
              <h4>Product</h4>
              <a href="#how">How it works</a>
              <a href="#own">What you own</a>
              <Link href="/demo">Try the demo</Link>
              <Link href="/app">Open the app</Link>
            </div>
            <div className={s.footerCol}>
              <h4>Built on</h4>
              {PARTNERS.map((p) => <a key={p.key} href={p.href} target="_blank" rel="noreferrer">{p.name}</a>)}
              <span>Real shares, tokenized 1:1</span>
            </div>
            <div className={s.footerCol}>
              <h4>Connect</h4>
              <a href="https://x.com/monvera_best" target="_blank" rel="noreferrer">@monvera_best on X</a>
              <a href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
            </div>
          </div>
          <div className={s.footerBottom}>
            <span>© 2026 Monvera. Stocks can go down as well as up; only invest what you can leave for a while.</span>
            <span className={s.mono}>Not investment advice · Capital at risk</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
