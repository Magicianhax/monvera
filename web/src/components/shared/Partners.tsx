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

// Virtuals — a protocol node (hexagon) with an agent core: Vera's identity + AI.
const VirtualsMark = (size: number) =>
  svg(
    size,
    <>
      <path d="M12 2.4 20.5 7.2v9.6L12 21.6 3.5 16.8V7.2z" strokeWidth="1.9" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
    </>,
    { stroke: true },
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
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)", padding: "12px 2px 6px" }}>
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
            <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: "-.01em" }}>{p.name}</div>
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
