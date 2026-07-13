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
import { ArrowUpRight, Sun, Moon, Menu, ChevronDown, Copy, Check } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextPlugin } from "gsap/TextPlugin";
import { useGSAP } from "@gsap/react";
import { displayFor } from "@/lib/displayAssets";
import { PARTNERS } from "@/components/shared/Partners";
import { FAQ } from "@/lib/faq";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { MonveraIcon } from "@/components/design";

// $MONVERA — the project token, launched on Virtuals Protocol on ROBINHOOD CHAIN
// (verified via the Virtuals API: chain "ROBINHOOD"), same chain the app runs on.
const TOKEN_CA = "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF";
const TOKEN_BUY_URL = "https://app.virtuals.io/virtuals/105667";
const TOKEN_EXPLORER_URL = `https://robinhoodchain.blockscout.com/token/${TOKEN_CA}`;
import { DemoMount } from "@/components/demo/DemoMount";
import type { DemoPlay } from "@/components/demo/DemoProvider";
import { ROADMAP } from "@/lib/roadmap";
import { StrategyCurve, pctLabel } from "./StrategyCurve";
import type { PublicStrategy } from "@/lib/server/strategies";
import { PhoneChrome } from "@/components/site/PhoneChrome";
import s from "./SiteLanding.module.css";
import { asset } from "@/lib/assets";

gsap.registerPlugin(useGSAP, ScrollTrigger, TextPlugin);

type Mode = "light" | "dark";

// Hero background slideshow — famous places from countries Monvera serves, shown
// in order. Media is hosted on Cloudflare R2 (see lib/assets.ts; prompts in docs/).
const HERO_SLIDES: { file: string; mascot: string }[] = [
  { file: "hero-01-tokyo.webp", mascot: "vera-01-tokyo.webp" },
  { file: "hero-02-tajmahal.webp", mascot: "vera-02-tajmahal.webp" },
  { file: "hero-03-dubai.webp", mascot: "vera-03-dubai.webp" },
  { file: "hero-04-istanbul.webp", mascot: "vera-04-istanbul.webp" },
  { file: "hero-05-singapore.webp", mascot: "vera-05-singapore.webp" },
  { file: "hero-06-rio.webp", mascot: "vera-06-rio.webp" },
  { file: "hero-07-capetown.webp", mascot: "vera-07-capetown.webp" },
  { file: "hero-08-cairo.webp", mascot: "vera-08-cairo.webp" },
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

export type VeraStats = {
  agentId: string;
  registryLive: boolean;
  plans: number;
  invested: number;
  placed: number;
  latest: { label: string; placed: boolean; usdc: number | null; txUrl: string } | null;
};

// Compact USD for the proof line: $0, $1.4K, $2.3M — landing headline scale.
function compactUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

export function SiteLanding({
  veraStats = null,
  strategies = [],
}: {
  veraStats?: VeraStats | null;
  /** The real strategy book, read server-side. Empty renders no preview. */
  strategies?: PublicStrategy[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("light");
  const [menuOpen, setMenuOpen] = useState(false);
  // $MONVERA contract-address copy feedback (resets after a beat).
  const [caCopied, setCaCopied] = useState(false);
  const copyCa = () => {
    navigator.clipboard
      .writeText(TOKEN_CA)
      .then(() => {
        setCaCopied(true);
        setTimeout(() => setCaCopied(false), 1800);
      })
      .catch(() => {});
  };
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreCloseTimer = useRef<number | null>(null);

  // Hover opens "More" on pointers that have one; a short close delay forgives
  // the trip from the button to the panel. Click and Escape still work, which is
  // what touch and keyboard use.
  const openMore = () => {
    if (moreCloseTimer.current !== null) {
      window.clearTimeout(moreCloseTimer.current);
      moreCloseTimer.current = null;
    }
    setMoreOpen(true);
  };
  const closeMoreSoon = () => {
    if (moreCloseTimer.current !== null) window.clearTimeout(moreCloseTimer.current);
    moreCloseTimer.current = window.setTimeout(() => setMoreOpen(false), 120);
  };
  useEffect(() => () => {
    if (moreCloseTimer.current !== null) window.clearTimeout(moreCloseTimer.current);
  }, []);

  // Dismiss the "More" menu on outside click or Escape, and return focus sanely.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  // Defer the 7 non-first hero slides + mascots to idle time: 16 large webps
  // otherwise compete with LCP on phone connections. The slideshow's first
  // transition starts at 3.6s, long after these land.
  const [heroReady, setHeroReady] = useState(false);
  useEffect(() => {
    const ric = window.requestIdleCallback?.bind(window);
    if (ric) {
      const id = ric(() => setHeroReady(true));
      return () => window.cancelIdleCallback?.(id);
    }
    const tm = window.setTimeout(() => setHeroReady(true), 1200);
    return () => window.clearTimeout(tm);
  }, []);

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

      // Hero background: world-landmarks slideshow (slide-only, no zoom).
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
        // No reason to animate 8 full-screen layers while the visitor reads
        // sections far below the hero.
        ScrollTrigger.create({
          trigger: ".js-hero",
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => { if (self.isActive) stl.play(); else stl.pause(); },
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

      // Section entrances, fitted per surface: lists stagger below; the CTA
      // card lands with a soft settle. The partner logos get no entrance at
      // all: gating trust marks behind a tween risks them sticking invisible.
      gsap.from(".js-cta", { opacity: 0, y: 24, scale: 0.985, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: ".js-cta", start: "top 84%" } });
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

  // The four destinations people actually come for stand on their own. The rest
  // live behind "More", so the bar stays short as the site grows.
  const PRIMARY = [
    ["#vera", "Vera"],
    ["#how", "How it works"],
    ["#strategies", "Strategies"],
    ["#token", "$MONVERA"],
    ["#roadmap", "Roadmap"],
  ] as const;
  const SECONDARY = [
    ["#own", "What you own"],
    ["#built", "Built on"],
    ["#faq", "FAQ"],
  ] as const;

  const primaryLinks = PRIMARY.map(([href, label]) => (
    <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
  ));
  const secondaryLinks = SECONDARY.map(([href, label]) => (
    <a key={href} href={href} onClick={() => { setMenuOpen(false); setMoreOpen(false); }}>{label}</a>
  ));
  const navLinks = (
    <>
      {primaryLinks}
      {secondaryLinks}
    </>
  );

  return (
    <div className={`site ${s.root}`} data-mode={mode} ref={root}>
      <div className={s.aura} aria-hidden />

      {/* NAV — short, floating, hides on scroll */}
      <nav className={`${s.nav} js-nav`}>
        <div className={s.navInner}>
          <a className={s.brand} href="#top"><MonveraIcon size={24} /> Monvera</a>
          <div className={s.navLinks}>
            {primaryLinks}
            <div className={s.more} ref={moreRef} onMouseEnter={openMore} onMouseLeave={closeMoreSoon}>
              <button
                type="button"
                className={s.moreBtn}
                onClick={() => setMoreOpen((o) => !o)}
                onFocus={openMore}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
              >
                More
                <ChevronDown size={15} strokeWidth={2.1} aria-hidden data-open={moreOpen || undefined} />
              </button>
              {moreOpen && (
                <div className={s.morePanel}>
                  <div className={s.morePanelCard} role="menu">
                    {secondaryLinks}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={s.navActions}>
            <button className={s.iconBtn} onClick={toggleMode} aria-label="Toggle theme">
              {mode === "dark" ? <Sun size={19} strokeWidth={1.9} /> : <Moon size={19} strokeWidth={1.9} />}
            </button>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnSm} ${s.navCta}`} href="/app">Open the app</Link>
            <button className={`${s.iconBtn} ${s.burger}`} onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
              <Menu size={20} strokeWidth={2} />
            </button>
          </div>
        </div>
        {menuOpen && <div className={s.navDrop}><div className={s.navDropPanel}>{navLinks}<Link href="/app" onClick={() => setMenuOpen(false)}>Open the app</Link></div></div>}
      </nav>

      {/* HERO — full-bleed world-landmarks slideshow + wordmark. Vera the mascot
          gets layered on top later, over the centre of the wordmark. */}
      <header id="top" className={`${s.heroFull} js-hero`}>
        <div className={s.heroSlides} aria-hidden>
          {HERO_SLIDES.map((sl, i) => (
            <div
              key={sl.file}
              className={`${s.heroSlide} js-slide`}
              style={i === 0 || heroReady ? { backgroundImage: `url(${asset(`/brand/hero/${sl.file}`)})` } : undefined}
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
          {HERO_SLIDES.map((sl, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={sl.mascot} className={`${s.mascot} js-mascot`} src={i === 0 || heroReady ? asset(`/brand/hero/${sl.mascot}`) : undefined} alt="" decoding="async" />
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
              <div className={s.sayWrap}>
                <span className={s.sayBubble}><span className="js-say">Grow $300, mostly big tech, keep some safe.</span><span className={s.caret}>▌</span></span>
              </div>
            </div>
            <div className={s.planCard}>
              <div className={s.planHead}><span className={s.dot} /> An example plan · balanced</div>
              <div className={s.planList}>
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
      <section className={`${s.section} ${s.sectionTightBottom}`} id="vera">
        <div className={s.wrap}>
          <div className={s.ownHead}>
            <h2 className={`${s.display} ${s.h2}`}>You stay in control.</h2>
          </div>
          <div className={`${s.pillars} js-stagger`}>
            <div className={s.pillar}>
              <div className={s.pillarStat}>Your <span>keys</span></div>
              <div className={s.pillarLabel}>Non-custodial</div>
              <p className={s.pillarText}>Monvera never holds your money. It lives in a wallet only you control, provable on-chain.</p>
            </div>
            <div className={s.pillar}>
              <div className={s.pillarStat}><span>$0</span> gas</div>
              <div className={s.pillarLabel}>Gasless, no platform fee</div>
              <p className={s.pillarText}>We cover every network fee and charge no account or platform fees. Monvera earns a small referral from the trading venue, not from you.</p>
            </div>
            <div className={s.pillar}>
              <div className={s.pillarStat}>On the <span>record</span></div>
              <div className={s.pillarLabel}>Signed on-chain</div>
              <p className={s.pillarText}>Every plan Vera signs is written on-chain, so her track record is public and can&apos;t be edited later.</p>
            </div>
          </div>
          {/* Vera's on-chain identity + latest signed plan — the real proof,
              read server-side from the same executor log the app and /agent use.
              Leads with verifiable identity (impressive at any volume) rather
              than raw counts. Mascot on the left, sized to the card's height. */}
          <div className={s.veraProof}>
          <img
            className={s.veraMascot}
            src={asset("/brand/vera-mascot.webp")}
            alt=""
            aria-hidden
            decoding="async"
          />
          <div className={s.veraRecord}>
            <div className={s.veraRecordHead}>
              <span className={s.veraRecordEyebrow}>Verified on-chain agent</span>
            </div>
            <div className={s.veraIdRow}>
              <div className={s.veraIdName}>
                Vera <span className={s.veraIdNum}>&#8470;{veraStats?.agentId ?? "1"}</span>
              </div>
              <span className={s.veraIdBadge}>ERC-8004 &middot; IdentityRegistry</span>
            </div>
            <p className={s.veraIdLine}>
              She signs every plan she builds and posts it to the chain. The record below
              is hers, and no one can edit it after the fact, us included.
            </p>
            {((veraStats?.plans ?? 0) > 0 || (veraStats?.invested ?? 0) > 0 || (veraStats?.placed ?? 0) > 0) && (
            <div className={s.veraStatStrip}>
              <div className={s.veraStatCell}>
                <span className={s.veraStatNum}>{(veraStats?.plans ?? 0).toLocaleString("en-US")}</span>
                <span className={s.veraStatLbl}>plans signed</span>
              </div>
              <div className={s.veraStatCell}>
                <span className={s.veraStatNum}>{compactUsd(veraStats?.invested ?? 0)}</span>
                <span className={s.veraStatLbl}>invested</span>
              </div>
              <div className={s.veraStatCell}>
                <span className={s.veraStatNum}>{(veraStats?.placed ?? 0).toLocaleString("en-US")}</span>
                <span className={s.veraStatLbl}>trades placed</span>
              </div>
            </div>
            )}
            {veraStats?.latest ? (
              <a className={s.veraLatest} href={veraStats.latest.txUrl} target="_blank" rel="noreferrer">
                <span className={s.veraLatestDot} aria-hidden />
                <span className={s.veraLatestText}>
                  Latest: a {veraStats.latest.label.toLowerCase()} plan
                  {veraStats.latest.placed && veraStats.latest.usdc !== null ? `, ${compactUsd(veraStats.latest.usdc)}` : ""} on-chain
                </span>
                <span className={s.veraLatestLink}>view tx <ArrowUpRight size={13} strokeWidth={2} /></span>
              </a>
            ) : (
              <div className={s.veraLatest}>
                <span className={s.veraLatestDot} aria-hidden />
                <span className={s.veraLatestText}>
                  Her first plans are landing now. Each one shows up here, for good.
                </span>
              </div>
            )}
            <Link href="/agent" className={s.veraRecordLink}>
              See her full record
              <ArrowUpRight size={16} strokeWidth={2} />
            </Link>
          </div>
          </div>
        </div>
      </section>

      {/* OWN — real companies, real logos */}
      <section className={`${s.section} ${s.sectionTightTop}`} id="own">
        <div className={s.wrap}>
          <div className={s.ownHead}>
            <h2 className={`${s.display} ${s.h2}`}>Own real shares of <span style={{ color: "var(--s-primary-d)" }}>95</span> companies and funds.</h2>
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
            <div className={s.phoneSlot}><Phone play="invest" mode={mode} /></div>
          </div>
        </div>
      </section>

      {/* STRATEGIES — the real book, read server-side. No data, no section. */}
      {strategies.length > 0 && (
        <section className={s.section} id="strategies">
          <div className={s.wrap}>
            <div className={s.stratHead}>
              <h2 className={`${s.display} ${s.h2}`}>Rules you can read, backtested in the open.</h2>
              <p className={s.lead}>
                Three rule-based portfolios, recomputed from real market data every six hours and tested walk-forward,
                so no rule gets credit for seeing the answer sheet. Solid line is the strategy, dashed is the S&amp;P 500.
              </p>
            </div>

            <ul className={`${s.stratList} js-stagger`}>
              {strategies.slice(0, 3).map((st) => (
                <li key={st.id} className={s.stratRow}>
                  <div className={s.stratName}>
                    <h3>{st.name}</h3>
                    <p>{st.tagline}</p>
                  </div>
                  <div className={s.stratCurve}>{st.backtest && <StrategyCurve bt={st.backtest} height={62} />}</div>
                  {st.backtest && (
                    <div className={s.stratNums}>
                      <div>
                        <span className={s.stratNum}>{pctLabel(st.backtest.portfolio.returnPct)}</span>
                        <span className={s.stratNumLabel}>6m walk-forward</span>
                      </div>
                      <div>
                        <span className={`${s.stratNum} ${s.stratNumMuted}`}>{pctLabel(st.backtest.benchmark.returnPct)}</span>
                        <span className={s.stratNumLabel}>S&amp;P 500</span>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <a className={s.viewAll} href="/strategies">
              See every strategy, its method, and its backtest <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden />
            </a>
          </div>
        </section>
      )}

      {/* ROADMAP — one rail, laid on its side. Certainty decays left to right. */}
      <section className={s.section} id="roadmap">
        <div className={s.wrap}>
          <div className={s.stratHead}>
            <h2 className={`${s.display} ${s.h2}`}>What is built, and what is still a guess.</h2>
            <p className={s.lead}>
              The line is solid where something already works, and it thins and breaks where we are still figuring it
              out. No dates, and nothing here is a promise.
            </p>
          </div>

          <ol className={`${s.track} js-stagger`}>
            {ROADMAP.map((phase) => (
              <li key={phase.phase} className={s.station} data-phase={phase.phase}>
                <span className={s.trackLine} aria-hidden />
                <span className={s.stationDot} aria-hidden />
                <h3 className={s.stationTitle}>
                  {phase.title} <span className={s.stationCount}>{phase.items.length}</span>
                </h3>
                <ul className={s.stationItems}>
                  {phase.items.slice(0, 3).map((it) => (
                    <li key={it.name}>{it.name}</li>
                  ))}
                  {phase.items.length > 3 && <li className={s.stationMore}>and {phase.items.length - 3} more</li>}
                </ul>
              </li>
            ))}
          </ol>

          <a className={s.viewAll} href="/roadmap">
            View the full roadmap <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden />
          </a>
        </div>
      </section>

      {/* BUILT ON */}
      <section className={s.section} id="built">
        <div className={s.wrap}>
          <div>
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
              live market quote, and <b>Vera</b> runs on <b>Virtuals</b>, which gives her a verifiable on-chain identity.
            </p>
          </div>
        </div>
      </section>

      {/* $MONVERA — the token, plainly: what it is, where it trades, the contract. */}
      <section className={s.section} id="token">
        <div className={s.wrap}>
          <div className={`${s.ctaCard} js-cta`}>
            <div className={s.ctaGlow} aria-hidden />
            <h2>$MONVERA</h2>
            <p>
              Monvera&apos;s token, launched on Virtuals Protocol and live on Robinhood Chain — the same chain the app
              settles on. It&apos;s how the community backs Vera — the app itself never requires it, and it isn&apos;t an
              investment product.
            </p>
            <div className={s.ctaCtas}>
              <a className={`${s.btn} ${s.btnLg} ${s.btnOnDark}`} href={TOKEN_BUY_URL} target="_blank" rel="noreferrer">
                Buy on Virtuals <ArrowUpRight size={18} strokeWidth={2.2} />
              </a>
              <a className={`${s.btn} ${s.btnLg} ${s.btnGhostOnDark}`} href={TOKEN_EXPLORER_URL} target="_blank" rel="noreferrer">
                View on Blockscout <ArrowUpRight size={18} strokeWidth={2.2} />
              </a>
            </div>
            <button type="button" className={s.tokenCa} onClick={copyCa} aria-label="Copy the $MONVERA contract address">
              <span className={s.mono}>{TOKEN_CA}</span>
              {caCopied ? <Check size={15} strokeWidth={2.4} aria-hidden /> : <Copy size={15} strokeWidth={2} aria-hidden />}
              <b>{caCopied ? "Copied" : "Copy"}</b>
            </button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={s.section} id="faq">
        <div className={s.wrap}>
          <div className={s.ownHead}>
            <h2 className={`${s.display} ${s.h2}`}>What people ask first.</h2>
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
          <p className={s.moreLink}>
            <Link href="/app">More answers inside the app &rarr;</Link>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className={s.section}>
        <div className={s.wrap}>
          <div className={`${s.ctaCard} js-cta`}>
            <div className={s.ctaGlow} aria-hidden />
            <h2>Your first investment is one sentence away.</h2>
            <p>Start with as little as $1, and sell back to digital dollars whenever you want. No lock-ups, no minimum balance.</p>
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
              <Link href="/agent">Meet Vera</Link>
              <Link href="/strategies">Open strategies</Link>
              <Link href="/demo">Try the demo</Link>
              <Link href="/app">Open the app</Link>
              <Link href="/roadmap">Roadmap</Link>
              <Link href="/themes">Theme baskets</Link>
              <a href="https://docs.monvera.best">Docs</a>
            </div>
            <div className={s.footerCol}>
              <h4>Built on</h4>
              {PARTNERS.map((p) => <a key={p.key} href={p.href} target="_blank" rel="noreferrer">{p.name}</a>)}
              <span>Real shares, tokenized 1:1</span>
            </div>
            <div className={s.footerCol}>
              <h4>Connect</h4>
              <a href="https://x.com/monvera_best" target="_blank" rel="noreferrer">@monvera_best on X</a>
              <a href={TOKEN_BUY_URL} target="_blank" rel="noreferrer">Buy $MONVERA</a>
              <a href={TOKEN_EXPLORER_URL} target="_blank" rel="noreferrer">$MONVERA on Blockscout</a>
              <Link href="/brand">Brand kit</Link>
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
