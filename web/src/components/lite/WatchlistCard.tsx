"use client";

// Home "Watchlist" section — the stocks the user has starred, with live price +
// day move, tapping through to the asset. Self-contained (fetches prices +
// market summary itself) so it only fires those requests when a watchlist
// exists. Renders nothing when empty.
import { useWatchlist } from "@/lib/watchlist";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { assetBySymbol } from "@/lib/tokens";
import { toTile } from "@/lib/displayAssets";
import { AssetTile, Sparkline, Icon } from "@/components/design";
import { usd } from "@/lib/format";
import { boxHead, innerBox } from "./screens/primitives";
import { WatchStar } from "./WatchStar";

export function WatchlistCard({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const watched = useWatchlist();
  const { data: prices } = usePrices();
  const { data: market } = useMarketSummary();
  const rows = watched.filter((s) => assetBySymbol(s));
  if (rows.length === 0) return null;

  return (
    <section style={{ padding: "22px 22px 0" }}>
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ ...boxHead, padding: "4px 6px 10px" }}>Watchlist</span>
          <button
            className="tap"
            onClick={() => go("market", { filter: "watchlist" })}
            style={{ background: "none", fontSize: 12.5, fontWeight: 600, color: "var(--primary)", padding: "0 6px 8px" }}
          >
            See all
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.slice(0, 5).map((symbol) => {
            const asset = assetBySymbol(symbol)!;
            const tile = toTile(symbol, asset.name);
            const live = market?.summary[symbol];
            const day = live?.dayChangePct;
            const spark = live?.spark ?? tile.spark;
            const price = prices?.prices[symbol]?.priceUsd ?? (live?.spark?.length ? live.spark[live.spark.length - 1] : undefined);
            const up = (day ?? 0) >= 0;
            return (
              <button
                key={symbol}
                className="tap"
                onClick={() => go("asset", { symbol })}
                style={{ ...innerBox }}
              >
                <AssetTile asset={tile} size={38} radius={12} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tile.name}
                  </div>
                  <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{symbol}</div>
                </div>
                <div style={{ flex: "none", display: "flex", justifyContent: "center", width: 60 }}>
                  <Sparkline data={spark} color={up ? "var(--pos)" : "var(--neg)"} />
                </div>
                <div className="tnum" style={{ textAlign: "right", minWidth: 58 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{price !== undefined ? usd(price) : "—"}</div>
                  {day !== undefined && (
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1, color: up ? "var(--pos)" : "var(--neg)" }}>
                      {(up ? "+" : "") + day.toFixed(2)}%
                    </div>
                  )}
                </div>
                <WatchStar symbol={symbol} size={17} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
