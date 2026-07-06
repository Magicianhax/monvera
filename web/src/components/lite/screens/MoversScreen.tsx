"use client";

// Movers — today's biggest gainers & losers across the whole universe, plus a
// "your holdings" cut. Pure new consumer of useMarketSummary (day% + spark for
// every asset, already cached) + usePrices; no new data pipeline.
import { useState } from "react";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor, toTile } from "@/lib/displayAssets";
import { usePrices } from "@/hooks/usePrices";
import { useMarketSummary } from "@/hooks/useMarket";
import { usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, AssetTile, Sparkline } from "@/components/design";
import { usd } from "@/lib/format";
import { boxHead, innerBox, iconBtn } from "./primitives";

type Mover = { symbol: string; name: string; day: number; spark: number[]; price?: number };

export function MoversScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const [tab, setTab] = useState<"gainers" | "losers">("gainers");
  const { data: prices } = usePrices();
  const { data: market, isLoading } = useMarketSummary();
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);

  const movers: Mover[] = [];
  for (const a of ALL_ASSETS) {
    const live = market?.summary[a.symbol];
    if (!live || live.dayChangePct === undefined) continue;
    const price = prices?.prices[a.symbol]?.priceUsd ?? (live.spark?.length ? live.spark[live.spark.length - 1] : undefined);
    movers.push({ symbol: a.symbol, name: displayFor(a.symbol, a.name).name, day: live.dayChangePct, spark: live.spark ?? [], price });
  }

  const sorted = [...movers].sort((a, b) => (tab === "gainers" ? b.day - a.day : a.day - b.day)).slice(0, 20);
  const heldSet = new Set((port?.holdings ?? []).map((h) => h.asset.symbol));
  const held = movers.filter((m) => heldSet.has(m.symbol)).sort((a, b) => Math.abs(b.day) - Math.abs(a.day));

  const Row = ({ m }: { m: Mover }) => {
    const tile = toTile(m.symbol, m.name);
    const up = m.day >= 0;
    return (
      <button key={m.symbol} className="tap" onClick={() => go("asset", { symbol: m.symbol })} style={{ ...innerBox }}>
        <AssetTile asset={tile} size={38} radius={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.name}</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{m.symbol}</div>
        </div>
        <div style={{ flex: "none", display: "flex", justifyContent: "center", width: 58 }}>
          <Sparkline data={m.spark} color={up ? "var(--pos)" : "var(--neg)"} />
        </div>
        <div className="tnum" style={{ textAlign: "right", minWidth: 58 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{m.price !== undefined ? usd(m.price) : "—"}</div>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 1, color: up ? "var(--pos)" : "var(--neg)" }}>{(up ? "+" : "") + m.day.toFixed(2)}%</div>
        </div>
      </button>
    );
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Movers today</h1>
      </div>

      {/* gainers / losers toggle */}
      <div style={{ display: "flex", gap: 8, padding: "16px 22px 0" }}>
        {(["gainers", "losers"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`chip tap ${tab === t ? "is-on" : ""}`} style={{ flex: 1, height: 36, textTransform: "capitalize" }} aria-pressed={tab === t}>
            {t === "gainers" ? "▲ Gainers" : "▼ Losers"}
          </button>
        ))}
      </div>

      <div style={{ padding: "18px 22px 0" }}>
        {held.length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 14 }}>
            <div style={{ ...boxHead }}>In your holdings</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{held.map((m) => <Row key={m.symbol} m={m} />)}</div>
          </div>
        )}
        {isLoading && sorted.length === 0 ? (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>{tab === "gainers" ? "Top gainers" : "Top losers"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ ...innerBox }}>
                  <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 12, flex: "none" }} />
                  <div style={{ flex: 1 }}><div className="skeleton" style={{ width: "50%", height: 13, borderRadius: 5 }} /><div className="skeleton" style={{ width: "30%", height: 10, borderRadius: 5, marginTop: 7 }} /></div>
                  <div className="skeleton" style={{ width: 54, height: 24, borderRadius: 5 }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>{tab === "gainers" ? "Top gainers" : "Top losers"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{sorted.map((m) => <Row key={m.symbol} m={m} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
