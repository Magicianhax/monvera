"use client";

// The live ticker tape that rides the top of the desktop content area. Real
// prices (usePrices) + real day-change (useMarketSummary), curated to a set of
// recognizable names. The row is duplicated so the marquee loops seamlessly.
import { useMemo } from "react";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { priceStr, dcol } from "./deskKit";

const TAPE = ["NVDA", "AAPL", "MSFT", "TSLA", "SPY", "GOOGL", "AMZN", "META", "COIN", "AMD", "QQQ", "PLTR", "ORCL", "CRCL"];

export function DesktopTicker() {
  const { data: prices } = usePrices();
  const { data: market } = useMarketSummary();

  const items = useMemo(() => {
    return TAPE.map((sym) => {
      const p = prices?.prices[sym]?.priceUsd;
      const day = market?.summary[sym]?.dayChangePct ?? 0;
      const tile = toTile(sym, sym);
      return { sym, tile, priceStr: p !== undefined ? priceStr(p) : "—", day };
    }).filter((x) => x.priceStr !== "—");
  }, [prices, market]);

  if (items.length === 0) return <div className="desk-ticker" aria-hidden />;

  const Row = () => (
    <>
      {items.map((t, i) => (
        <div key={t.sym + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderRight: "1px solid var(--line-2)", whiteSpace: "nowrap" }}>
          <AssetTile asset={t.tile} size={18} radius={5} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{t.sym}</span>
          <span className="tnum" style={{ fontSize: 12, color: "var(--ink-2)" }}>{t.priceStr}</span>
          <span className="tnum" style={{ fontSize: 11.5, fontWeight: 600, color: dcol(t.day) }}>
            {(t.day >= 0 ? "+" : "") + t.day.toFixed(2)}%
          </span>
        </div>
      ))}
    </>
  );

  return (
    <div className="desk-ticker">
      <div className="desk-ticker-track">
        <Row />
        <Row />
      </div>
    </div>
  );
}
