// Partners — the real third-party infrastructure behind Monvera, credited with
// their marks and a one-line, honest role each. Single source of truth for both
// the marketing landing (`SiteLanding` "Built on" row) and the in-app Help
// screen (`PartnerStrip`). Marks are monochrome SVG (currentColor) so they sit
// in any theme; the Robinhood feather is the real brand mark.
import type { ReactNode } from "react";

export interface Partner {
  key: string;
  name: string;
  href: string;
  /** One plain-language sentence: what this partner actually does for you. */
  role: string;
  mark: (size: number) => ReactNode;
}

const svg = (size: number, children: ReactNode, opts?: { stroke?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={opts?.stroke ? "none" : "currentColor"}
    stroke={opts?.stroke ? "currentColor" : undefined}
    aria-hidden
    style={{ display: "block" }}
  >
    {children}
  </svg>
);

// Robinhood — the real feather mark (Simple Icons, monochromed to currentColor).
const RobinhoodMark = (size: number) =>
  svg(
    size,
    <path d="M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852" />,
  );

// Arcus — nested rising arcs (arcus = arc/bow): the venue that prices + routes.
const ArcusMark = (size: number) =>
  svg(
    size,
    <>
      <path d="M2.6 17.5a9.4 9.4 0 0 1 18.8 0" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M7 17.5a5 5 0 0 1 10 0" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="1.7" fill="currentColor" stroke="none" />
    </>,
    { stroke: true },
  );

// Virtuals - their real logomark (the swoosh "V" + dot), traced to a monochrome
// alpha mask so it renders in currentColor and adapts to any theme, matching the
// other marks. Single source of truth: change it here, it updates the landing +
// Help screen everywhere. (Source: virtuals.io official mark.)
const VIRTUALS_MASK =
  "data:image/png;base64,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";
const VirtualsMark = (size: number) => (
  <span
    aria-hidden
    style={{
      display: "block",
      width: size * 1.49, // the swoosh is landscape (149x100)
      height: size,
      background: "currentColor",
      WebkitMaskImage: `url("${VIRTUALS_MASK}")`,
      maskImage: `url("${VIRTUALS_MASK}")`,
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      WebkitMaskSize: "contain",
      maskSize: "contain",
      WebkitMaskPosition: "center",
      maskPosition: "center",
    }}
  />
);

export const PARTNERS: Partner[] = [
  {
    key: "robinhood",
    name: "Robinhood Chain",
    href: "https://docs.robinhood.com/chain",
    role: "The Ethereum L2 where every trade settles: fast, low-cost, and provable on-chain.",
    mark: RobinhoodMark,
  },
  {
    key: "arcus",
    name: "Arcus",
    href: "https://arcus.xyz",
    role: "The on-chain venue that prices and routes every buy and sell at a live market quote.",
    mark: ArcusMark,
  },
  {
    key: "virtuals",
    name: "Virtuals",
    href: "https://virtuals.io",
    role: "The agent network behind Vera: her verifiable on-chain identity and the AI that builds your plans.",
    mark: VirtualsMark,
  },
];

// In-app partner credit — a glass card of the infrastructure behind Monvera,
// each linking out. Used on the Help screen.
export function PartnerStrip() {
  return (
    <div className="card" style={{ padding: "6px 16px", marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", padding: "12px 2px 6px" }}>
        The infrastructure behind Monvera
      </div>
      {PARTNERS.map((p, i) => (
        <a
          key={p.key}
          href={p.href}
          target="_blank"
          rel="noopener noreferrer"
          className="row tap"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "13px 0",
            textDecoration: "none",
            borderTop: i > 0 ? "1px solid var(--line-2)" : "none",
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: "var(--r-sm)",
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            {p.mark(20)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-.01em" }}>{p.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4 }}>{p.role}</div>
          </div>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} style={{ color: "var(--ink-3)", flex: "none" }} aria-hidden>
            <path d="M7 17 17 7M8 7h9v9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ))}
    </div>
  );
}
