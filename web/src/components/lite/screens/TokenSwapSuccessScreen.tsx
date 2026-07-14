"use client";

// Token swap success — the full-page receipt after a $MONVERA buy or sell
// (mirrors the invest SuccessScreen moment: confetti, check burst, then the
// facts). Shows exactly what was paid and what arrived, with token logos and
// the Blockscout proof link. "Done" pops back to the token screen, which
// remounts with a clean swap panel.
import { useEffect } from "react";
import { formatUnits } from "viem";
import { Confetti, Icon } from "@/components/design";
import { TokenLogo } from "../TokenLogo";
import { EXPLORER_URL } from "@/lib/chain";
import { haptic } from "@/lib/haptics";
import type { MonveraSwapResult } from "@/hooks/useMonveraSwap";

// Whole-token display for 18dp MONVERA amounts (sub-token dust isn't meaningful
// at a sub-cent price).
function fmtMonvera(raw: bigint): string {
  return Math.floor(Number(formatUnits(raw, 18))).toLocaleString("en-US");
}
function fmtUsdg(raw: bigint): string {
  return Number(formatUnits(raw, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TokenSwapSuccessScreen({
  go,
  result,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  result?: MonveraSwapResult;
}) {
  // Celebrate on arrival (same buzz as an invest success).
  useEffect(() => {
    if (result) haptic.success();
  }, [result]);

  // Deep-linked or remounted without a result — nothing to show, go home.
  useEffect(() => {
    if (!result) go("home");
  }, [result, go]);
  if (!result) return null;

  const sold = result.side === "sell";
  const paid = sold
    ? { symbol: "MONVERA", amount: `${fmtMonvera(result.amountIn)} MONVERA` }
    : { symbol: "USDG", amount: `$${fmtUsdg(result.amountIn)} USDG` };
  const received = sold
    ? { symbol: "USDG", amount: `≈ $${fmtUsdg(result.amountOut)} USDG` }
    : { symbol: "MONVERA", amount: `≈ ${fmtMonvera(result.amountOut)} MONVERA` };

  const legRow = (label: string, leg: { symbol: string; amount: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 16px" }}>
      <TokenLogo symbol={leg.symbol} size={40} />
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</div>
        <div className="tnum" style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", marginTop: 1 }}>
          {leg.amount}
        </div>
      </div>
    </div>
  );

  return (
    <div className="screen screen-pad-top" style={{ display: "flex", flexDirection: "column", minHeight: "100%", paddingBottom: 24 }}>
      <Confetti />

      <div style={{ flex: 1, padding: "36px 22px 0", textAlign: "center" }}>
        {/* check burst — same treatment as the invest success moment */}
        <div className="anim-rise" style={{ position: "relative", width: 92, height: 92, margin: "18px auto 22px" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: -16,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent), transparent 70%)",
              filter: "blur(14px)",
              animation: "softBurst 1.2s var(--ease-out) both",
            }}
          />
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: "50%",
              background: "var(--hero-grad)",
              display: "grid",
              placeItems: "center",
              position: "relative",
              color: "var(--primary-ink)",
            }}
          >
            <Icon name="check" size={40} stroke={2.6} />
          </div>
        </div>

        <h1 className="anim-rise serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em", animationDelay: ".05s" }}>
          {sold ? "Sold $MONVERA" : "Bought $MONVERA"}
        </h1>
        <div className="anim-rise" style={{ marginTop: 6, fontSize: 13.5, color: "var(--ink-2)", animationDelay: ".1s" }}>
          Swapped on Robinhood Chain · gasless
        </div>

        {/* paid -> received */}
        <div
          className="anim-rise"
          style={{
            margin: "24px 0 0",
            background: "var(--surface)",
            borderRadius: "var(--rr)",
            boxShadow: "var(--shadow)",
            overflow: "hidden",
            position: "relative",
            animationDelay: ".15s",
          }}
        >
          {legRow("You paid", paid)}
          <div style={{ height: 1, background: "var(--line-2)", margin: "0 16px" }} />
          {legRow("You received", received)}
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: "50%",
              right: 18,
              transform: "translateY(-50%)",
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "var(--surface-2)",
              color: "var(--ink-3)",
              boxShadow: "var(--shadow)",
              fontSize: 14,
            }}
          >
            ↓
          </span>
        </div>

        <a
          className="anim-rise tap"
          href={`${EXPLORER_URL}/tx/${result.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginTop: 18,
            fontSize: 13.5,
            fontWeight: 500,
            color: "var(--primary)",
            textDecoration: "none",
            animationDelay: ".2s",
          }}
        >
          View transaction on Blockscout
          <Icon name="arrowUR" size={13} />
        </a>
      </div>

      <div style={{ padding: "18px 22px 0" }}>
        <button
          className="btn btn-primary btn-block btn-lg tap"
          onClick={() => {
            haptic.light();
            go(-1);
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
