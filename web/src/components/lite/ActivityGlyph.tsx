"use client";

// The leading glyph for an activity row: a single token logo for a transfer,
// or an overlapping PAIR (what was given + what was received) for a swap.
//   buy  = USDG -> stock   (USDG behind, stock in front)
//   sell = stock -> USDG   (stock behind, USDG in front)
import { TokenLogo } from "./TokenLogo";
import type { WalletEvent } from "@/lib/walletActivity";

export function ActivityGlyph({
  event,
  size = 40,
  ring = "var(--surface-2)",
}: {
  event: WalletEvent;
  size?: number;
  /** Color of the ring cut around the front logo (should match the row bg). */
  ring?: string;
}) {
  const buyLike = event.kind === "buy" || event.kind === "groveBuy";
  const isTrade = buyLike || event.kind === "sell" || event.kind === "groveExit";
  if (!isTrade) return <TokenLogo symbol={event.symbol} size={size} />;

  const from = buyLike ? "USDG" : event.symbol;
  const to = buyLike ? event.symbol : "USDG";
  const small = Math.round(size * 0.66);
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }} aria-hidden>
      <span style={{ position: "absolute", left: 0, top: 0 }}>
        <TokenLogo symbol={from} size={small} />
      </span>
      <span
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          borderRadius: "50%",
          boxShadow: `0 0 0 2px ${ring}`,
        }}
      >
        <TokenLogo symbol={to} size={small} />
      </span>
    </div>
  );
}
