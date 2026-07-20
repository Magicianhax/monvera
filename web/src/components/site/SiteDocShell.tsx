"use client";

// Chrome for the standalone marketing documents: /agent, /strategies,
// /roadmap, /buyback. Same room as the landing — the emerald V4 canvas, the
// floating glass nav capsule, and the full-directory footer — so moving
// between the landing and any document never changes worlds. The `.site`
// scope is pinned to dark so every page's --s-* tokens resolve to the dark
// palette, then remapped onto the official app tokens in the module css.

import { type ReactNode } from "react";
import { SiteFooterV4, SiteNavV4 } from "./SiteChromeV4";
import v4 from "./SiteLandingV4.module.css";
import s from "./SiteDocShell.module.css";

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
  return (
    <div className={`site ${v4.root} ${s.doc}`} data-mode="dark">
      <SiteNavV4 />
      <main className={`${s.main} ${wide ? s.wide : ""}`}>
        <header className={s.head}>
          <p className={v4.eyebrow}>{eyebrow}</p>
          <h1 className={`${v4.display} ${s.h1}`}>{title}</h1>
          <p className={s.lead}>{lead}</p>
        </header>
        {children}
      </main>
      <SiteFooterV4 />
    </div>
  );
}
