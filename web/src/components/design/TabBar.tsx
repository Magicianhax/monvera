"use client";

// Monvera bottom tab bar — flat, full-width, hairline-topped; inline primary
// "Invest" action. The active tab's icon does a small GSAP pop on switch
// (state feedback, reduced-motion safe). Tab set depends on `pro`.
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Icon, type IconName } from "./Icon";

gsap.registerPlugin(useGSAP);

export type TabId = "home" | "portfolio" | "market" | "invest" | "vera";

interface Tab {
  id: TabId;
  icon: IconName;
  label: string;
  center?: boolean;
}

export interface TabBarProps {
  active: TabId;
  onNav: (id: TabId) => void;
  pro?: boolean;
}

export function TabBar({ active, onNav, pro = false }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  // Pop the newly-active tab's icon — quick scale overshoot, transform-only.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          `[data-tab="${active}"] svg`,
          { scale: 0.82 },
          { scale: 1, duration: 0.42, ease: "back.out(2.2)", transformOrigin: "center" },
        );
      });
      return () => mm.revert();
    },
    { scope: barRef, dependencies: [active] },
  );

  const ordered: Tab[] = pro
    ? [
        { id: "home", icon: "home", label: "Home" },
        { id: "market", icon: "grid", label: "Market" },
        { id: "invest", icon: "spark", label: "Invest", center: true },
        { id: "portfolio", icon: "trend", label: "Owned" },
        { id: "vera", icon: "orbit", label: "Vera" },
      ]
    : [
        { id: "home", icon: "home", label: "Home" },
        { id: "portfolio", icon: "trend", label: "Owned" },
        { id: "invest", icon: "spark", label: "Invest", center: true },
        { id: "vera", icon: "orbit", label: "Vera" },
      ];

  return (
    <div
      ref={barRef}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
        background: "var(--surface)",
        borderTop: "1px solid var(--line)",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
      }}
    >
      {ordered.map((t) => {
        const on = active === t.id;
        if (t.center) {
          return (
            <button
              key={t.id}
              data-tab={t.id}
              onClick={() => onNav(t.id)}
              aria-label={t.label}
              className={`tab-fab${on ? " is-active" : ""}`}
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: "var(--primary)",
                color: "var(--primary-ink)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name="spark" size={24} stroke={2} />
            </button>
          );
        }
        return (
          <button
            key={t.id}
            data-tab={t.id}
            onClick={() => onNav(t.id)}
            className="tap"
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: 4,
              color: on ? "var(--primary)" : "var(--ink-3)",
              flex: 1,
              minWidth: 0,
              transition: "color .2s var(--ease-out)",
            }}
          >
            {/* ledger indicator — a short rule above the active tab, not a pill */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -8,
                left: "50%",
                transform: "translateX(-50%)",
                width: on ? 22 : 0,
                height: 2,
                background: "var(--primary)",
                transition: "width .22s var(--ease-out)",
              }}
            />
            <Icon name={t.icon} size={23} stroke={on ? 2.2 : 1.8} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
