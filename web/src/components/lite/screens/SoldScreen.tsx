"use client";

// SoldScreen — the sell-all receipt. Each holding was its own on-chain trade, so
// every row carries its own Blockscout receipt. Most sells settle over a few
// minutes (RFQ fills unwrap into USDG), so we say "cashing out", not "cashed" —
// honest about money that's on the way, not yet landed.
import { useEffect } from "react";
import { Confetti, SectionTitle, HoldingRow, Icon } from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, txUrl } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import type { SellSuccess } from "@/hooks/useSellAll";

export function SoldScreen({ success, onDone }: { success: SellSuccess; onDone: () => void }) {
  const { totalUsd, sold, anySettling } = success;

  useEffect(() => {
    haptic.success();
  }, []);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <Confetti />

      <div style={{ padding: "30px 22px 0", textAlign: "center" }}>
        <div style={{ position: "relative", width: 92, height: 92, margin: "10px auto 22px" }}>
          <span aria-hidden style={{ position: "absolute", inset: -16, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent), transparent 70%)", filter: "blur(14px)", animation: "softBurst 1.2s var(--ease-out) both" }} />
          <div style={{ width: 92, height: 92, borderRadius: "50%", background: "var(--hero-grad)", display: "grid", placeItems: "center", animation: "pop .6s var(--ease-soft) both", boxShadow: "var(--shadow-lg)" }}>
            <svg width="46" height="46" viewBox="0 0 46 46" className="check-draw">
              <path d="M12 24l8 8 16-17" fill="none" stroke="var(--primary-ink)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <h1 className="serif" style={{ fontSize: 32, margin: "0 0 8px", letterSpacing: "-.01em" }}>
          {anySettling ? "Cashing out." : "Sold."}
        </h1>
        <p style={{ fontSize: 16, color: "var(--ink-2)", margin: 0 }}>
          <b className="tnum">~{usd(totalUsd)}</b> heading back to your cash across {sold.length}{" "}
          {sold.length === 1 ? "holding" : "holdings"}.
        </p>
        {anySettling && (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px 0 0", maxWidth: 300, marginInline: "auto" }}>
            Each trade is signed and on-chain now; the USDG lands in a few minutes as the fills settle.
          </p>
        )}
      </div>

      <div style={{ padding: "26px 22px 0" }}>
        <SectionTitle>What you sold</SectionTitle>
        <div className="card" style={{ padding: "4px 14px" }}>
          {sold.map((h, i) => (
            <div key={h.symbol} style={{ borderBottom: i < sold.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <HoldingRow
                asset={toTile(h.symbol, h.name)}
                sub={catFor(h.symbol, h.name)}
                showSpark={false}
                right={
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <div className="tnum" style={{ fontWeight: 600, fontSize: 16 }}>~{usd(h.amountUsd)}</div>
                    {h.txHash && (
                      <a
                        href={txUrl(h.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tap"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 11.5, fontWeight: 500, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 3, textDecoration: "none" }}
                      >
                        Receipt <Icon name="arrowUR" size={11} />
                      </a>
                    )}
                  </div>
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "sticky", bottom: 0, marginTop: "auto", padding: "16px 22px calc(18px + env(safe-area-inset-bottom))", background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)" }}>
        <button className="btn btn-primary btn-block btn-lg tap" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
