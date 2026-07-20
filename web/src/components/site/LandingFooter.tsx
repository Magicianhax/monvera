"use client";

// Landing footer — naked on the aurora, ten links, three honest legal lines.
// No brand blurb paragraph, no partner logos, no newsletter, no repeated CTA.
import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/seo";
import f from "./LandingFooter.module.css";

const RECORD_URL = "https://robinhoodchain.blockscout.com/address/0x7ff1a5ee19330c165146488a7ad8af6cb41da1df";

export function LandingFooter() {
  return (
    <footer className={f.footer}>
      <div className={f.grid}>
        <div className={f.brand}>
          <span className={f.wordmark}>Monvera</span>
          <span className={f.sig}>A broker you talk to.</span>
          <a className={f.record} href={RECORD_URL} target="_blank" rel="noreferrer">
            Record: 0x7ff1…1df ↗
          </a>
        </div>
        <div className={f.col}>
          <span className={f.label}>App</span>
          <Link href="/app">Open the app</Link>
          <a href="#how">How it works</a>
          <a href="#roadmap">Roadmap</a>
          <a href="https://docs.monvera.best">Docs</a>
        </div>
        <div className={f.col}>
          <span className={f.label}>Elsewhere</span>
          <a href="https://x.com/monvera_best" target="_blank" rel="noreferrer">X</a>
          <a href="#token">$MONVERA</a>
          <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Blockscout</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
        </div>
      </div>
      <div className={f.legal}>
        <div className={f.legalLeft}>
          <span>© 2026 Monvera · Not investment advice · Capital at risk</span>
          <span>$MONVERA is a community token, not an investment product.</span>
        </div>
        <span>Available worldwide</span>
      </div>
    </footer>
  );
}
