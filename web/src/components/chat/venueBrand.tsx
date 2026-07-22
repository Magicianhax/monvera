"use client";

// Venue identity — one source of truth for the name, brand colour and mark of
// every execution venue, used by the order ticket, the chat receipt and the
// batch conveyor.
//
// Marks are the venues' REAL logos, self-hosted under /public/venues so the
// strict CSP allows them (hotlinking a brand CDN would be blocked) and a trade
// never shows a broken image because someone else's host is down. They ship as
// square tiles with their own backgrounds, so they render like the asset logos
// elsewhere in the app: rounded, never tinted.
//
// Every venue also keeps a geometric fallback mark. If a file is missing or
// fails to decode we draw that instead of leaving a hole in the receipt.
import { useState } from "react";
import type { VenueName } from "@/hooks/useSwap";

export interface VenueBrand {
  label: string;
  /** Brand colour — used for the winner accent (border tint, "best price"). */
  color: string;
  /** Self-hosted logo under /public/venues. Absent = fallback mark only. */
  src?: string;
  /** Drawn when `src` is missing or fails to load. */
  fallback: (size: number) => React.ReactElement;
}

const uniswapMark = (s: number) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M12.4 3.1c1.9 1.6 2.7 3.9 2.3 6.2-.4 2.6-2.2 4.8-4.7 5.9" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    <circle cx="12.9" cy="6.1" r="1.05" fill="currentColor" />
  </svg>
);
const lifiMark = (s: number) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M4 13.4c2.6 0 3.4-6.8 6-6.8s3.4 6.8 6 6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="4" cy="13.4" r="1.7" fill="currentColor" />
    <circle cx="16" cy="13.4" r="1.7" fill="currentColor" />
  </svg>
);
const kyberMark = (s: number) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M10 2.4 17 10l-7 7.6L3 10z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
    <path d="M10 2.4v15.2M3 10h14" stroke="currentColor" strokeWidth="1.35" opacity=".5" />
  </svg>
);
const arcusMark = (s: number) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M3.2 14.6a6.8 6.8 0 0 1 13.6 0" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    <circle cx="10" cy="14.6" r="1.6" fill="currentColor" />
  </svg>
);
const rialtoMark = (s: number) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M3 13.8c3.5 0 3.5-7 7-7s3.5 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M3 16.4h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".55" />
  </svg>
);

export const VENUE: Record<VenueName, VenueBrand> = {
  uniswap: { label: "Uniswap", color: "#FF007A", src: "/venues/uniswap.png", fallback: uniswapMark },
  lifi: { label: "LI.FI", color: "#E0A8F5", src: "/venues/lifi.png", fallback: lifiMark },
  kyber: { label: "KyberSwap", color: "#31CB9E", src: "/venues/kyberswap.png", fallback: kyberMark },
  arcus: { label: "Arcus", color: "#6E8BFF", fallback: arcusMark },
  rialto: { label: "Rialto", color: "#C08BFF", fallback: rialtoMark },
};

/**
 * The venue's logo at `size`. `muted` desaturates rather than recolours — these
 * are real brand tiles with baked backgrounds, so they can't be tinted.
 */
export function VenueMark({ venue, size = 16, muted }: { venue: VenueName; size?: number; muted?: boolean }) {
  const b = VENUE[venue];
  const [broken, setBroken] = useState(false);
  const common: React.CSSProperties = {
    width: size, height: size, flex: "none",
    // Ledger radii: small tiles stay at 4-5px, never pills.
    borderRadius: Math.max(3, Math.round(size * 0.26)),
    opacity: muted ? 0.5 : 1,
    filter: muted ? "grayscale(1)" : "none",
    transition: "opacity 260ms cubic-bezier(.23,1,.32,1), filter 260ms cubic-bezier(.23,1,.32,1)",
  };

  if (b.src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={b.src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ ...common, objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <span aria-hidden style={{ ...common, display: "grid", placeItems: "center", color: b.color, filter: "none" }}>
      {b.fallback(size)}
    </span>
  );
}

export const venueLabel = (v: VenueName) => VENUE[v]?.label ?? v;

/** Narrow an untrusted string to a venue we can actually render.
 *  `/api/venues` is fetched at runtime and its values index straight into
 *  VENUE[v].color; one unrecognised name would throw inside render and take
 *  down the conveyor overlay mid-batch. Filter through this at every fetch. */
export const isVenue = (v: unknown): v is VenueName => typeof v === "string" && v in VENUE;
