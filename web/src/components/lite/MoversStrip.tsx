"use client";

// Home "Movers today" strip — a horizontal scroll of the biggest movers across
// the universe, each tapping through to the asset. Self-contained (fetches the
// cached market summary itself). Renders nothing until data arrives.
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor, toTile } from "@/lib/displayAssets";
import { useMarketSummary } from "@/hooks/useMarket";
import { AssetTile, Icon } from "@/components/design";
import { boxHead } from "./screens/primitives";

export function MoversStrip({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const { data: market } = useMarketSummary();
  if (!market) return null;

  const movers = ALL_ASSETS.map((a) => {
    const live = market.summary[a.symbol];
    return live && live.dayChangePct !== undefined ? { symbol: a.symbol, name: displayFor(a.symbol, a.name).name, day: live.dayChangePct } : null;
  })
    .filter((m): m is { symbol: string; name: string; day: number } => m !== null)
    .sort((a, b) => Math.abs(b.day) - Math.abs(a.day))
    .slice(0, 10);
  if (movers.length === 0) return null;

  return (
    <section style={{ padding: "22px 0 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 22px" }}>
        <span style={{ ...boxHead, padding: "0 0 10px" }}>Movers today</span>
        <button className="tap" onClick={() => go("movers")} style={{ background: "none", fontSize: 12.5, fontWeight: 500, color: "var(--primary)", padding: "0 0 8px" }}>
          See all
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "0 22px 2px", scrollbarWidth: "none" }}>
        {movers.map((m) => {
          const tile = toTile(m.symbol, m.name);
          const up = m.day >= 0;
          return (
            <button
              key={m.symbol}
              className="tap"
              onClick={() => go("asset", { symbol: m.symbol })}
              style={{
                flex: "none",
                width: 118,
                background: "var(--surface)",
                border: "1px solid var(--line-2)",
                borderRadius: "var(--r-lg)",
                boxShadow: "var(--shadow)",
                overflow: "hidden",
                padding: "12px",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AssetTile asset={tile} size={28} radius={9} />
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{m.symbol}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name={up ? "trend" : "trendDown"} size={14} style={{ color: up ? "var(--pos)" : "var(--neg)" }} />
                <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: up ? "var(--pos)" : "var(--neg)" }}>
                  {(up ? "+" : "") + m.day.toFixed(2)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
