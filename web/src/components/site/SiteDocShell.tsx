"use client";

// Chrome for the standalone marketing documents: /roadmap, /agent, /strategies.
// They used to render inside `.stax`, the app's phone frame (max-width 440px,
// height 100dvh, overflow hidden), which clipped them and blocked scrolling.
// They belong on the marketing `.site` scope instead, which is what this gives
// them, along with the landing's theme, type, and persisted light/dark mode.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Sun, Moon } from "lucide-react";
import { MonveraIcon } from "@/components/design";
import { SUPPORT_EMAIL } from "@/lib/seo";
import s from "./SiteDocShell.module.css";

type Mode = "light" | "dark";

export function SiteDocShell({
  eyebrow,
  title,
  lead,
  children,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
  /** Wider measure for data-dense documents like the strategy book. */
  wide?: boolean;
}) {
  // Share the landing's persisted theme so moving between pages never flashes
  // a different world. Defaults to light until the stored value is read.
  const [mode, setMode] = useState<Mode>("light");
  useEffect(() => {
    const saved = localStorage.getItem("monvera-landing-mode") ?? localStorage.getItem("stax-landing-mode");
    if (saved === "dark" || saved === "light") setMode(saved);
  }, []);
  const toggleMode = () =>
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      localStorage.setItem("monvera-landing-mode", next);
      return next;
    });

  return (
    <div className={`site ${s.root}`} data-mode={mode}>
      <header className={s.bar}>
        <div className={s.barInner}>
          <Link className={s.brand} href="/">
            <MonveraIcon size={22} /> Monvera
          </Link>
          <div className={s.spacer} />
          <Link className={s.barLink} href="/#vera">Vera</Link>
          <Link className={s.barLink} href="/#strategies">Strategies</Link>
          <Link className={s.barLink} href="/#roadmap">Roadmap</Link>
          <button className={s.iconBtn} onClick={toggleMode} aria-label="Toggle theme">
            {mode === "dark" ? <Sun size={17} strokeWidth={1.9} /> : <Moon size={17} strokeWidth={1.9} />}
          </button>
          <Link className={s.cta} href="/app">Open the app</Link>
        </div>
      </header>

      <main className={`${s.main} ${wide ? s.wide : ""}`}>
        <p className={s.eyebrow}>{eyebrow}</p>
        <h1 className={s.h1}>{title}</h1>
        <p className={s.lead}>{lead}</p>

        {children}

        <footer className={s.foot}>
          <div className={s.footLinks}>
            <Link href="/">Home</Link>
            <Link href="/demo">Try the demo</Link>
            <Link href="/buyback">Buyback</Link>
            <a href="https://docs.monvera.best">Docs</a>
            <Link href="/brand">Brand kit</Link>
            <a href="https://x.com/monvera_best" target="_blank" rel="noreferrer">@monvera_best</a>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </div>
          Monvera is not available in the US, Canada, the UK, or Switzerland. Nothing here is investment advice, and
          backtests are history rather than a promise. Stocks can go down as well as up.
        </footer>
      </main>
    </div>
  );
}
