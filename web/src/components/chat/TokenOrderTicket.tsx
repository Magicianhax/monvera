"use client";

// $MONVERA buy/sell ticket — same design chrome as the stock OrderTicket, but
// wired to useMonveraSwap (MONVERA trades over its own gasless v2/Matcha route,
// NOT the Arcus stock flow). Manual trading stays manual: this opens from the
// token canvas's Buy/Sell, never from chat. Amount is entered in USD.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { useMonveraSwap } from "@/hooks/useMonveraSwap";
import { useMonveraPrice } from "@/hooks/useMonveraToken";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { CircleNotch } from "@phosphor-icons/react";
import { PIcon, usd, priceStr, type ChatNav } from "./chatKit";
import type { OrderState } from "./OrderTicket";
import { consumeOrderAmountPrefill } from "./autopilotPrefill";

const clean = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const ZERO = BigInt(0);
const PRESETS = [{ label: "25%", f: 0.25 }, { label: "50%", f: 0.5 }, { label: "Max", f: 1 }] as const;

function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (/user (rejected|denied)|rejected the request|request rejected|user cancel/i.test(msg)) return "You cancelled the signature — nothing was traded.";
  return msg.length > 180 ? msg.slice(0, 177) + "…" : msg;
}

export function TokenOrderTicket({ order, onClose, nav }: { order: OrderState; onClose: () => void; nav: ChatNav }) {
  const d = displayFor("MONVERA");
  const { address } = useSmartAccount();
  const { data: tok } = useMonveraPrice();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const swap = useMonveraSwap();

  const [side, setSide] = useState<"buy" | "sell">(order.side);
  // Chat handoff: "buy $20 of MONVERA" arrives with the amount already set.
  const [amt, setAmt] = useState(() => { const p2 = consumeOrderAmountPrefill(); return p2 ? String(p2) : ""; });

  // Exit mirrors the entrance: panel de-materializes, scrim fades, then unmount.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 190);
  }, [onClose]);
  const n = parseFloat(amt) || 0;

  const cash = bal?.value ?? 0;
  const price = tok?.priceUsd ?? 0;
  const held = useMemo(() => (port?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA"), [port]);
  const heldRaw = held?.raw ?? ZERO;
  const heldQty = held?.qty ?? (heldRaw > ZERO ? Number(formatUnits(heldRaw, 18)) : 0);
  const heldUsd = held?.valueUsd ?? heldQty * price;

  // sell sizing: typed USD → raw MONVERA, whole-position (no dust) past the max.
  const sellRaw = (() => {
    if (side !== "sell" || heldRaw <= ZERO || !price || price <= 0 || n <= 0) return ZERO;
    const qtyWanted = n / price;
    if (qtyWanted >= heldQty) return heldRaw;
    try { return parseUnits(qtyWanted.toFixed(18), 18); } catch { return ZERO; }
  })();

  const over = side === "buy" && n > cash + 1e-6;
  const ready = side === "buy"
    ? n > 0 && !over && price > 0 && !!address
    : sellRaw > ZERO && !!address;

  const outQty = price > 0 ? n / price : 0; // MONVERA moved either way
  const avail = side === "sell" ? `${usd(heldUsd)} owned` : `${usd(cash)} available`;

  const reason = side === "buy"
    ? n <= 0 ? "Enter an amount" : over ? `That's more than your ${usd(cash)} cash` : price <= 0 ? "Loading price…" : null
    : heldRaw <= ZERO ? "You don't hold any $MONVERA yet — buy some first." : sellRaw <= ZERO ? "Enter an amount" : null;

  const switchSide = (s: "buy" | "sell") => { if (swap.busy || s === side) return; setSide(s); setAmt(""); swap.reset(); };

  const submit = () => {
    if (swap.busy || !ready) return;
    if (side === "buy") { void swap.buy(n); return; }
    void swap.sell(sellRaw);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !swap.busy) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swap.busy, close]);

  const done = swap.phase === "done" && swap.result;

  return (
    <div className={closing ? "fadein fadeout" : "fadein"} onClick={() => { if (!swap.busy) close(); }} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(8,14,10,.22)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24 }}>
      <div className={closing ? "glassin glassout" : "glassin"} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 55%),var(--panel)", backdropFilter: "blur(14px) saturate(170%)", WebkitBackdropFilter: "blur(14px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 24, boxShadow: "0 24px 70px rgba(8,20,12,.34)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0 16px" }}>
          <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 999, padding: 3, gap: 2 }}>
            <button onClick={() => switchSide("buy")} style={{ height: 32, padding: "0 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, background: side === "buy" ? "var(--bg)" : "transparent", boxShadow: side === "buy" ? "0 1px 4px rgba(12,32,20,.14)" : "none", color: side === "buy" ? "var(--primary)" : "var(--ink-3)" }}>Buy</button>
            <button onClick={() => switchSide("sell")} style={{ height: 32, padding: "0 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, background: side === "sell" ? "var(--bg)" : "transparent", boxShadow: side === "sell" ? "0 1px 4px rgba(12,32,20,.14)" : "none", color: side === "sell" ? "var(--neg)" : "var(--ink-3)" }}>Sell</button>
          </div>
          <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}><PIcon name="ph-x" size={15} weight="bold" /></button>
        </div>

        {done && swap.result ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 22px 22px", textAlign: "center" }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--primary)", display: "grid", placeItems: "center" }}><PIcon name="ph-check" size={30} weight="bold" style={{ color: "var(--primary-ink)" }} /></div>
            <div className="serif" style={{ fontSize: 22, fontWeight: 500, marginTop: 12 }}>{swap.result.side === "sell" ? "Sold" : "Bought"} $MONVERA</div>
            <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.55 }}>Done, gasless as always. Balances update in a moment.</p>
            <button onClick={() => { nav.openCanvas("token"); close(); }} style={{ width: "100%", height: 48, marginTop: 18, borderRadius: 16, fontSize: 14.5, fontWeight: 700, color: "var(--primary-ink)", background: "var(--primary)" }}>View $MONVERA</button>
            <button onClick={close} style={{ width: "100%", height: 42, marginTop: 8, borderRadius: 16, fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)", background: "var(--panel-2)" }}>Done</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 22px 22px", textAlign: "center" }}>
            <AssetTile asset={d} size={46} radius={14} />
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 10 }}>$MONVERA</div>
            <div className="tnum" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{price > 0 ? priceStr(price) : "—"}</div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 3, marginTop: 16 }}>
              <span className="serif" style={{ fontSize: 24, color: "var(--ink-3)" }}>$</span>
              <input value={amt} onChange={(e) => { setAmt(clean(e.target.value)); if (swap.error) swap.reset(); }} inputMode="decimal" placeholder="0" autoFocus aria-label={`Amount to ${side} in dollars`} className="serif tnum" style={{ width: 150, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 44, fontWeight: 500, letterSpacing: "-.02em", textAlign: "center" }} />
            </div>
            <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>≈ {outQty > 0 ? outQty.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0"} MONVERA · {avail}</div>
            <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => { const base = side === "sell" ? heldUsd : cash; setAmt((Math.floor(base * p.f * 100) / 100).toFixed(2)); if (swap.error) swap.reset(); }} style={{ height: 32, padding: "0 15px", border: "1px solid var(--line)", borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: "transparent", color: "var(--ink-2)" }}>{p.label}</button>
              ))}
            </div>

            {swap.error && <button onClick={swap.reset} style={{ width: "100%", marginTop: 12, background: "color-mix(in srgb,var(--neg) 10%,transparent)", border: "1px solid color-mix(in srgb,var(--neg) 30%,transparent)", borderRadius: 12, padding: "10px 13px", fontSize: 12.5, color: "var(--neg)", textAlign: "left", lineHeight: 1.5 }}>{friendly(swap.error)}</button>}

            <button onClick={submit} disabled={!ready || swap.busy} style={{ width: "100%", height: 52, marginTop: 18, borderRadius: 16, fontSize: 15.5, fontWeight: 700, color: "#fff", background: side === "sell" ? "var(--neg)" : "var(--primary)", opacity: ready || swap.busy ? 1 : 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {swap.busy ? (<><CircleNotch size={17} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} />{swap.phase === "quoting" ? "Getting a price…" : swap.phase === "preparing" ? "Preparing…" : side === "buy" ? "Buying…" : "Selling…"}</>) : `${side === "sell" ? "Sell" : "Buy"} ${usd(n)}`}
            </button>
            {!swap.busy && !ready && reason && <div style={{ fontSize: 12, color: over ? "var(--neg)" : "var(--ink-3)", marginTop: 9 }}>{reason}</div>}

            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)", marginTop: 14 }}><PIcon name="ph-lock-key" size={13} weight="fill" style={{ color: "var(--primary)" }} /> Self-custody · gasless · via Matcha</div>
          </div>
        )}
      </div>
    </div>
  );
}
