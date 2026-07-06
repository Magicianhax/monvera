"use client";

// MoversRow — a horizontal "Today's movers" carousel: the biggest day moves
// (up or down) as glass cards with a gradient mini-sparkline, price, and colored
// %. Shared by Market and Home. Real day data (market summary); the caller
// supplies a price lookup so this stays decoupled from the prices hook.
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { AssetTile, Sparkline } from "@/components/design";
import { usd } from "@/lib/format";

interface Summary {
  [symbol: string]: { dayChangePct: number; spark: number[] } | undefined;
}

export function MoversRow({
  summary,
  priceOf,
  go,
  title = "Today's movers",
  count = 12,
  boxed = false,
}: {
  summary?: Summary;
  priceOf?: (symbol: string) => number | undefined;
  go: (screen: string, params?: Record<string, unknown>) => void;
  title?: string;
  count?: number;
  /** Render inside a section card (matches Home's boxed holdings/activity). */
  boxed?: boolean;
}) {
  if (!summary) return null;
  const movers = ALL_ASSETS.map((asset) => ({ asset, d: displayFor(asset.symbol, asset.name), e: summary[asset.symbol] }))
    .filter((x) => x.e && Number.isFinite(x.e.dayChangePct) && x.e.dayChangePct !== 0)
    .sort((a, b) => Math.abs(b.e!.dayChangePct) - Math.abs(a.e!.dayChangePct))
    .slice(0, count);
  if (movers.length === 0) return null;

  const titlePad = boxed ? "0 4px 10px" : "0 22px 10px";
  const scrollPad = boxed ? "0 4px 2px" : "0 22px 2px";
  const strip = (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)", padding: titlePad }}>{title}</div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: scrollPad, scrollSnapType: "x proximity" }}>
        {movers.map(({ asset, d, e }) => {
          const up = (e?.dayChangePct ?? 0) >= 0;
          // Price: Chainlink (via priceOf) → latest market close (spark's last
          // point, same source as the % + chart) → indicative reference. Most
          // tokens have no on-chain feed, so the close fills the gap.
          const marketLast = e?.spark?.length ? e.spark[e.spark.length - 1] : undefined;
          const price = priceOf?.(asset.symbol) ?? marketLast ?? d.price;
          return (
            <button
              key={asset.symbol}
              onClick={() => go("asset", { symbol: asset.symbol })}
              className="card tap"
              style={{
                flex: "none",
                width: 132,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-start",
                scrollSnapAlign: "start",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                <AssetTile asset={d} size={26} radius={9} />
                <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-.01em" }}>{d.ticker ?? asset.symbol}</span>
              </div>
              <Sparkline data={e?.spark ?? []} color={up ? "var(--pos)" : "var(--neg)"} w={108} h={30} strong />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
                <span className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>{price !== undefined ? usd(price) : "—"}</span>
                <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: up ? "var(--pos)" : "var(--neg)" }}>
                  {(up ? "+" : "") + (e?.dayChangePct ?? 0).toFixed(1)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );

  return boxed ? (
    <div className="card anim-rise" style={{ padding: 12, overflow: "hidden" }}>{strip}</div>
  ) : (
    <div className="anim-rise">{strip}</div>
  );
}
