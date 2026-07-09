"use client";

// The full roadmap rail. Certainty decays as you descend: solid where things
// shipped, hairline where they are being built, dashed and fading where they
// are only being explored.
//
// Motion: a single decorative progress line is scrubbed by scroll, so the road
// appears to build ahead of the reader. Everything else is already visible with
// JS off (gsap.from animates toward the resting state, never away from it).

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ROADMAP } from "@/lib/roadmap";
import s from "./RoadmapRail.module.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

function Check() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function RoadmapRail() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);

      // The road builds as you read it. `from` scaleY(0) -> resting scaleY(1).
      gsap.from(q(`.${s.progress}`), {
        scaleY: 0,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top 72%", end: "bottom 75%", scrub: 0.6 },
      });

      // Markers settle as the line reaches them.
      q(`.${s.item}`).forEach((el) => {
        gsap.from(el, {
          opacity: 0,
          y: 8,
          duration: 0.45,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
        });
      });
    },
    { scope: root },
  );

  return (
    <div className={s.rail} ref={root}>
      <span className={s.progress} aria-hidden />
      <ol className={s.list}>
        {ROADMAP.map((phase) => (
          <li key={phase.phase} className={s.phase} data-phase={phase.phase}>
            <span className={s.seg} aria-hidden />
            <div className={s.head}>
              <span className={s.node} aria-hidden>
                {phase.phase === "live" ? <Check /> : null}
              </span>
              <h2 className={s.title}>
                {phase.title}
                <span className={s.count}>{phase.items.length}</span>
              </h2>
              <p className={s.lede}>{phase.lede}</p>
            </div>
            <ul className={s.items}>
              {phase.items.map((item) => (
                <li key={item.name} className={s.item}>
                  <span className={s.dot} aria-hidden />
                  <h3 className={s.name}>{item.name}</h3>
                  <p className={s.note}>{item.note}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
