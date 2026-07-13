"use client";

// SellScreen — cash out some or all of your holdings in one pass. Every tradable
// holding is preselected at 100% (the "sell everything" default); untick what you
// want to keep, or dial any holding down with the 25/50/75/All chips. Then choose
// who taps sign — Vera (auto) or you (approve each step) — and place it. Mirrors
// the invest flow's language so buying and selling feel like one system.
import { useMemo, useState } from "react";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { Icon, VeraOrb } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { usd, tokenQty } from "@/lib/format";
import { catFor } from "@/lib/displayAssets";
import { isTradable } from "@/lib/tokens";
import { haptic } from "@/lib/haptics";
import { iconBtn } from "./primitives";
import type { InvestMode } from "@/hooks/useInvest";
import type { SellSelection } from "@/hooks/useSellAll";

const PCTS = [25, 50, 75, 100] as const;

interface Pick {
  on: boolean;
  pct: number;
}

export function SellScreen({
  onBack,
  onSell,
}: {
  onBack: () => void;
  onSell: (selections: SellSelection[], mode: InvestMode) => void;
}) {
  const { address } = useSmartAccount();
  const { data: port } = usePortfolio(address ?? undefined);

  // Only holdings we can actually route a sell for, with a known value.
  const sellable: Holding[] = useMemo(
    () => (port?.holdings ?? []).filter((h) => isTradable(h.asset.symbol) && (h.valueUsd ?? 0) > 0 && h.raw > BigInt(0)),
    [port],
  );

  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [mode, setMode] = useState<InvestMode>("auto");

  // Default: every holding selected at 100%.
  const pickFor = (sym: string): Pick => picks[sym] ?? { on: true, pct: 100 };
  const setPick = (sym: string, next: Partial<Pick>) =>
    setPicks((p) => ({ ...p, [sym]: { ...pickFor(sym), ...next } }));

  const chosen = sellable.filter((h) => pickFor(h.asset.symbol).on);
  const totalUsd = chosen.reduce((s, h) => s + (h.valueUsd ?? 0) * (pickFor(h.asset.symbol).pct / 100), 0);
  const allOn = chosen.length === sellable.length && sellable.length > 0;

  const build = (): SellSelection[] =>
    chosen.map((h) => {
      const pct = pickFor(h.asset.symbol).pct;
      const amountIn = pct >= 100 ? h.raw : (h.raw * BigInt(pct)) / BigInt(100);
      return { asset: h.asset, amountIn, estUsd: (h.valueUsd ?? 0) * (pct / 100) };
    });

  const canSell = chosen.length > 0 && totalUsd > 0;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={onBack} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
      </div>

      <div className="anim-rise" style={{ padding: "12px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <VeraOrb size={30} />
          <h1 className="serif" style={{ margin: 0, fontSize: 25 }}>
            Sell holdings
          </h1>
        </div>
        <p className="body" style={{ marginTop: 4, maxWidth: 320 }}>
          Everything&apos;s selected to cash out. Untick what you want to keep, or dial any holding down. Vera swaps
          each back to USDG.
        </p>
      </div>

      {sellable.length === 0 ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--ink-2)" }}>
          Nothing to sell yet — your holdings will show up here once you&apos;ve invested.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px 8px" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
              {chosen.length} of {sellable.length} selected
            </span>
            <button
              className="tap"
              onClick={() => {
                haptic.select();
                const next = !allOn;
                setPicks(Object.fromEntries(sellable.map((h) => [h.asset.symbol, { on: next, pct: pickFor(h.asset.symbol).pct }])));
              }}
              style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}
            >
              {allOn ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 22px" }}>
            {sellable.map((h) => {
              const sym = h.asset.symbol;
              const pk = pickFor(sym);
              const dec = h.asset.decimals ?? 18;
              const sellUsd = (h.valueUsd ?? 0) * (pk.pct / 100);
              return (
                <div
                  key={sym}
                  style={{
                    border: `1.5px solid ${pk.on ? "var(--primary)" : "var(--line-2)"}`,
                    background: pk.on ? "var(--primary-soft, var(--surface-2))" : "var(--surface)",
                    borderRadius: "var(--r)",
                    padding: "12px 14px",
                    transition: "border-color .18s, background .18s",
                  }}
                >
                  <button
                    className="tap"
                    onClick={() => {
                      haptic.select();
                      setPick(sym, { on: !pk.on });
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left" }}
                  >
                    <TokenLogo symbol={sym} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15.5 }}>{h.asset.name}</div>
                      <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>
                        {tokenQty(h.raw, dec)} {sym} · {usd(h.valueUsd ?? 0)}
                      </div>
                    </div>
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        flex: "none",
                        display: "grid",
                        placeItems: "center",
                        background: pk.on ? "var(--primary)" : "transparent",
                        border: `2px solid ${pk.on ? "var(--primary)" : "var(--line-2)"}`,
                        color: "var(--primary-ink)",
                      }}
                    >
                      {pk.on && <Icon name="check" size={14} stroke={3} />}
                    </span>
                  </button>

                  {pk.on && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
                      {PCTS.map((p) => {
                        const active = pk.pct === p;
                        return (
                          <button
                            key={p}
                            className="tap"
                            onClick={() => {
                              haptic.light();
                              setPick(sym, { pct: p });
                            }}
                            style={{
                              flex: 1,
                              padding: "7px 0",
                              borderRadius: 8,
                              fontSize: 12.5,
                              fontWeight: 600,
                              background: active ? "var(--primary)" : "var(--surface)",
                              color: active ? "var(--primary-ink)" : "var(--ink-2)",
                              border: `1px solid ${active ? "var(--primary)" : "var(--line-2)"}`,
                            }}
                          >
                            {p === 100 ? "All" : `${p}%`}
                          </button>
                        );
                      })}
                      <span className="tnum" style={{ marginLeft: 4, fontSize: 13, fontWeight: 600, minWidth: 62, textAlign: "right" }}>
                        {usd(sellUsd)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* who signs — the same auto/manual choice as investing, kept compact */}
          <div style={{ padding: "20px 22px 0" }}>
            <div style={{ display: "flex", gap: 8, background: "var(--surface-2)", padding: 4, borderRadius: 12 }}>
              {([
                { m: "auto" as const, icon: "spark" as const, label: "Let Vera sell" },
                { m: "manual" as const, icon: "shield" as const, label: "Approve each" },
              ]).map((o) => {
                const on = mode === o.m;
                return (
                  <button
                    key={o.m}
                    className="tap"
                    onClick={() => {
                      haptic.select();
                      setMode(o.m);
                    }}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      padding: "10px 0",
                      borderRadius: 9,
                      fontSize: 13.5,
                      fontWeight: 600,
                      background: on ? "var(--surface)" : "transparent",
                      color: on ? "var(--ink)" : "var(--ink-2)",
                      boxShadow: on ? "var(--shadow)" : "none",
                    }}
                  >
                    <Icon name={o.icon} size={15} style={{ color: on ? "var(--primary)" : "var(--ink-3)" }} />
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>
              {mode === "auto"
                ? "Vera signs each sell for you — one tap, nothing to approve."
                : "You approve every sell in your wallet, one holding at a time."}
            </p>
          </div>
        </>
      )}

      {sellable.length > 0 && (
        <div style={{ position: "sticky", bottom: 0, marginTop: 18, padding: "12px 22px calc(18px + env(safe-area-inset-bottom))", background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)" }}>
          <button
            className="btn btn-primary btn-block btn-lg tap"
            disabled={!canSell}
            style={{ opacity: canSell ? 1 : 0.5 }}
            onClick={() => {
              if (!canSell) return;
              haptic.medium();
              onSell(build(), mode);
            }}
          >
            {chosen.length === sellable.length ? "Sell everything" : `Sell ${chosen.length} ${chosen.length === 1 ? "holding" : "holdings"}`} · ~{usd(totalUsd)}
          </button>
        </div>
      )}
    </div>
  );
}
