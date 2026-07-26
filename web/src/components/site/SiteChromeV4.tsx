"use client";

// Shared chrome for the emerald marketing surfaces: the floating glass nav
// capsule and the full-directory footer, styled by SiteLandingV4.module.css.
// Used by the landing (/) and every SiteDocShell document (/agent,
// /strategies, /roadmap, /buyback) so the whole site is one room.
import { useEffect, useState } from "react";
import Link from "next/link";
import { MonveraWordmark } from "@/components/design/Brand";
import s from "./SiteLandingV4.module.css";

export const DOCS_URL = "https://docs.monvera.best";
export const X_URL = "https://x.com/monvera_best";
export const TOKEN_CA = "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF";
export const VIRTUALS_URL = "https://app.virtuals.io/virtuals/105667";
export const DEX_URL = "https://www.geckoterminal.com/robinhood/pools/0x502Be3da0Ad1c83C79A9e64Ac5A05eEc39A44c78";
export const TOKEN_EXPLORER_URL = `https://robinhoodchain.blockscout.com/token/${TOKEN_CA}`;
export const VERA_CONTRACT_URL =
  "https://robinhoodchain.blockscout.com/address/0x7ff1a5ee19330c165146488a7ad8af6cb41da1df";

const NAV_LINKS = [
  { label: "Groves", href: "/groves" },
  { label: "Staking", href: "/stake" },
  { label: "Agent", href: "/agent" },
  { label: "Strategies", href: "/strategies" },
  { label: "Roadmap", href: "/roadmap" },
  { label: "Buyback", href: "/buyback" },
  { label: "Docs", href: DOCS_URL, external: true },
];

const FOOT_PRODUCT = [
  { label: "Open the app", href: "/app" },
  { label: "Groves", href: "/groves" },
  { label: "Staking", href: "/stake" },
  { label: "Vera's record", href: "/agent" },
  { label: "Strategies", href: "/strategies" },
  { label: "Themes", href: "/themes" },
  { label: "Roadmap", href: "/roadmap" },
  { label: "Buyback", href: "/buyback" },
];
const FOOT_RESOURCES = [
  { label: "Documentation", href: DOCS_URL, external: true },
  { label: "FAQ", href: "/faq" },
  { label: "Live demo", href: "/demo" },
  { label: "Brand kit", href: "/brand" },
  { label: "Vera's contract", href: VERA_CONTRACT_URL, external: true },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];
const FOOT_TOKEN = [
  { label: "$MONVERA on Virtuals", href: VIRTUALS_URL, external: true },
  { label: "Chart on GeckoTerminal", href: DEX_URL, external: true },
  { label: "Token on Blockscout", href: TOKEN_EXPLORER_URL, external: true },
];

export function Arrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h10M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function External() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5M9.5 2.5h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    </svg>
  );
}

export function SiteNavV4() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <>
      <header className={s.nav} data-scrolled={scrolled}>
        <Link href="/" className={s.navBrand} aria-label="Monvera home">
          <MonveraWordmark size={21} />
        </Link>
        <nav className={s.navLinks} aria-label="Site">
          {NAV_LINKS.map((l) =>
            l.external ? (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href}>
                {l.label}
              </Link>
            ),
          )}
        </nav>
        <Link href="/app" className={`${s.cta} ${s.navCta}`}>
          Open Monvera <Arrow />
        </Link>
        <button
          type="button"
          className={s.burger}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <i />
          <i />
        </button>
      </header>

      {menuOpen && (
        <div className={s.sheet} role="dialog" aria-label="Menu">
          <nav onClick={() => setMenuOpen(false)}>
            {NAV_LINKS.map((l) =>
              l.external ? (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href}>
                  {l.label}
                </Link>
              ),
            )}
          </nav>
          <Link href="/app" className={`${s.cta} ${s.sheetCta}`} onClick={() => setMenuOpen(false)}>
            Open Monvera <Arrow />
          </Link>
        </div>
      )}
    </>
  );
}

export function SiteFooterV4() {
  return (
    <footer className={s.footer}>
      <div className={s.wrap}>
        <div className={s.footGrid}>
          <div className={s.footBrand}>
            <MonveraWordmark size={22} />
            <p className={s.footTag}>
              The AI broker for real tokenized stocks. Talk to Vera, own the result.
            </p>
            <a className={s.footX} href={X_URL} target="_blank" rel="noopener noreferrer">
              <XLogo /> @monvera_best
            </a>
          </div>
          <div className={s.footCol}>
            <h3>Product</h3>
            <nav aria-label="Product">
              {FOOT_PRODUCT.map((l) => (
                <Link key={l.label} href={l.href}>
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className={s.footCol}>
            <h3>Resources</h3>
            <nav aria-label="Resources">
              {FOOT_RESOURCES.map((l) =>
                l.external ? (
                  <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.label}
                  </a>
                ) : (
                  <Link key={l.label} href={l.href}>
                    {l.label}
                  </Link>
                ),
              )}
            </nav>
          </div>
          <div className={s.footCol}>
            <h3>$MONVERA</h3>
            <nav aria-label="Token">
              {FOOT_TOKEN.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
        <div className={s.footLegal}>
          <p className={s.footSmall}>
            &copy; 2026 Monvera &middot;{" "}
            <Link href="/terms" className={s.footLegalLink}>Terms</Link> &middot;{" "}
            <Link href="/privacy" className={s.footLegalLink}>Privacy</Link>
          </p>
          <div className={`${s.footChain} ${s.mono}`}>
            Built on <b>Robinhood Chain</b>
            <br />
            Settled in USDG &middot; Recorded on Blockscout
          </div>
        </div>
      </div>
    </footer>
  );
}
