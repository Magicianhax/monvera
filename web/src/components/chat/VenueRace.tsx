"use client";

// VenueRace — the best-execution comparison behind a trade, made visible.
//
// Every buy/sell quotes each enabled venue in parallel and the biggest fill
// wins. That work used to be invisible: "Placing order…" then a receipt. Two
// beats now show it:
//
//   1. quote in flight — the venues, each lighting up as it's polled
//   2. fill landed     — the real board, winner first, with the margin it won by
//
// The numbers are real server quote amounts, never decoration. With a single
// responding venue there is no race, so it says "Filled on X" rather than
// implying a contest that never happened.
import { useEffect, useState } from "react";
import type { VenueBoard, VenueName } from "@/hooks/useSwap";
import { VENUE, VenueMark, venueLabel } from "./venueBrand";

export const VENUE_RACE_CSS = `
@keyframes mvvSweep{0%{background-position:-140% 0}100%{background-position:240% 0}}
@keyframes mvvIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes mvvPulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.35);opacity:1}}
@keyframes mvvWin{0%{transform:scale(.94)}60%{transform:scale(1.02)}100%{transform:scale(1)}}
.mvv-sweep{
  background:linear-gradient(90deg,var(--ink-3) 0%,var(--ink) 45%,var(--ink-3) 90%);
  background-size:240% 100%;-webkit-background-clip:text;background-clip:text;
  color:transparent;animation:mvvSweep 1.15s linear infinite;
}
.mvv-in{animation:mvvIn .3s cubic-bezier(.23,1,.32,1) both}
.mvv-win{animation:mvvWin .34s cubic-bezier(.23,1,.32,1) both}
.mvv-pulse{animation:mvvPulse 1.1s ease-in-out infinite}
.mvv-chip{transition:border-color 260ms cubic-bezier(.23,1,.32,1),background-color 260ms cubic-bezier(.23,1,.32,1),transform 260ms cubic-bezier(.23,1,.32,1)}
@media (prefers-reduced-motion:reduce){
  .mvv-sweep{animation:none;background:none;-webkit-background-clip:border-box;background-clip:border-box;color:var(--ink-2)}
  .mvv-in,.mvv-win,.mvv-pulse{animation:none}
  .mvv-chip{transition:none}
}
`;

/** Beat 1 — who is being asked, while the quote is in flight. */
export function VenueRaceLive({ venues }: { venues: VenueName[] }) {
  const [tick, setTick] = useState(0);
  const racing = venues.length > 1;
  useEffect(() => {
    // Guard inside the effect, not before it: hooks can't be conditional, and
    // without this the timer still ticks for a component rendering nothing.
    if (!racing) return;
    const id = setInterval(() => setTick((t) => t + 1), 460);
    return () => clearInterval(id);
  }, [racing]);
  if (!racing) return null;
  const active = tick % venues.length;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="mvv-sweep" style={{ fontSize: 11.5, fontWeight: 650 }}>
        {venues.length} venues competing for your best rate…
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {venues.map((v, i) => {
          const on = i === active;
          return (
            <span
              key={v}
              className="mvv-chip"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 6,
                border: `1px solid ${on ? `color-mix(in srgb, ${VENUE[v].color} 55%, transparent)` : "var(--line)"}`,
                background: on ? `color-mix(in srgb, ${VENUE[v].color} 9%, transparent)` : "transparent",
                transform: on ? "translateY(-1px)" : "none",
                fontSize: 12, fontWeight: 600,
                color: on ? "var(--ink)" : "var(--ink-3)",
              }}
            >
              <VenueMark venue={v} size={15} muted={!on} />
              {venueLabel(v)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Beat 2 — the settled board, best first. */
export function VenueRaceResult({ board, decimals, compact }: {
  board: VenueBoard;
  decimals: number;
  /** Tighter styling for the chat receipt / conveyor rail. */
  compact?: boolean;
}) {
  if (!board.length) return null;
  const win = board[0];

  // Never claim a "win" when nobody was beaten.
  if (board.length === 1) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ink-3)" }}>
        <VenueMark venue={win.venue} size={15} />
        Filled on <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>{venueLabel(win.venue)}</strong>
      </div>
    );
  }

  const best = Number(win.buyAmount) / 10 ** decimals;
  const next = Number(board[1].buyAmount) / 10 ** decimals;
  const edge = next > 0 ? ((best - next) / next) * 100 : 0;

  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--ink-3)", marginBottom: 6 }}>
        Best price of {board.length} venues
      </div>
      {board.map((r, i) => {
        const amt = Number(r.buyAmount) / 10 ** decimals;
        const behind = i === 0 ? 0 : ((best - amt) / best) * 100;
        const winner = i === 0;
        return (
          <div
            key={r.venue}
            className={winner ? "mvv-win" : "mvv-in"}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: compact ? "6px 9px" : "7px 10px",
              marginBottom: 3, borderRadius: 6,
              animationDelay: `${i * 55}ms`,
              border: `1px solid ${winner ? `color-mix(in srgb, ${VENUE[r.venue].color} 42%, transparent)` : "transparent"}`,
              background: winner ? `color-mix(in srgb, ${VENUE[r.venue].color} 8%, transparent)` : "transparent",
            }}
          >
            <VenueMark venue={r.venue} size={16} muted={!winner} />
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: winner ? 700 : 500, color: winner ? "var(--ink)" : "var(--ink-3)" }}>
              {venueLabel(r.venue)}
            </span>
            <span
              className="tnum"
              style={{ fontSize: 12, fontWeight: winner ? 700 : 500, color: winner ? VENUE[r.venue].color : "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}
            >
              {winner ? "best price" : `−${behind.toFixed(2)}%`}
            </span>
          </div>
        );
      })}
      {edge > 0.005 && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5, lineHeight: 1.5 }}>
          {venueLabel(win.venue)} paid you{" "}
          <strong style={{ color: "var(--primary)", fontWeight: 700 }}>{edge.toFixed(2)}% more</strong> than the next best.
        </div>
      )}
    </div>
  );
}

/** One-line winner badge — for the chat trade card and per-leg rows. */
export function VenueBadge({ venue, beat }: { venue: VenueName; beat?: number }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 8px", borderRadius: 5,
        border: `1px solid color-mix(in srgb, ${VENUE[venue].color} 34%, transparent)`,
        background: `color-mix(in srgb, ${VENUE[venue].color} 8%, transparent)`,
        fontSize: 11.5, fontWeight: 650, color: "var(--ink-2)", whiteSpace: "nowrap",
      }}
    >
      <VenueMark venue={venue} size={13} />
      {venueLabel(venue)}
      {beat !== undefined && beat > 0.005 && (
        <span className="tnum" style={{ color: VENUE[venue].color, fontWeight: 700 }}>+{beat.toFixed(2)}%</span>
      )}
    </span>
  );
}

/** Margin the winner beat the runner-up by, or 0 when it ran unopposed. */
export function winnerEdge(board: VenueBoard | undefined, decimals: number): number {
  if (!board || board.length < 2) return 0;
  const best = Number(board[0].buyAmount) / 10 ** decimals;
  const next = Number(board[1].buyAmount) / 10 ** decimals;
  return next > 0 ? ((best - next) / next) * 100 : 0;
}
