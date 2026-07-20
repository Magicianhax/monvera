"use client";

// Order ticket — the "Monvera Chat" design's buy/sell overlay (design L487-508 +
// script L670-689 / L835-844), wired to the REAL manual trading flow: the exact
// same hooks as the classic TradeScreen (useQuote/useSellQuote → useSwap.buy/sell,
// gasless sponsored UserOps, RFQ retry inside executeSwap). Buy sizes against
// USDG cash; sell against the held position. Glass panels keep the exact
// style={{ background: "var(--panel)", ... }} idiom (theme highlight selector).
import { useCallback, useEffect, useRef, useState } from "react";
import { parseUnits } from "viem";
import { assetBySymbol, isTradable } from "@/lib/tokens";
import { RFQ_MIN_BUY_USD, RFQ_MIN_SELL_USD } from "@/lib/arcusShared";
import { useQuote, useSellQuote } from "@/hooks/useQuote";
import { useTradability } from "@/hooks/useMarket";
import { useSwap } from "@/hooks/useSwap";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { usePrice } from "@/hooks/usePrices";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { fromUnits } from "@/lib/format";
import { CircleNotch } from "@phosphor-icons/react";
import { PIcon, usd, priceStr, type ChatNav } from "./chatKit";
import { consumeOrderAmountPrefill } from "./autopilotPrefill";
import { haptic } from "@/lib/haptics";

export interface OrderState { symbol: string; side: "buy" | "sell" }

// digits + a single decimal point only (same rule as TradeScreen)
const clean = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

/** Hook errors, kept short and human. */
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  // Only a GENUINE user rejection reads as "you cancelled" — venue errors also
  // contain "rejected" (a rejected quote is not a cancelled signature).
  if (/user (rejected|denied)|rejected the request|request rejected|user cancel/i.test(msg)) return "You cancelled the signature — nothing was traded.";
  return msg.length > 180 ? msg.slice(0, 177) + "…" : msg;
}

const PRESETS = [
  { label: "25%", f: 0.25 },
  { label: "50%", f: 0.5 },
  { label: "Max", f: 1 },
] as const;

export function OrderTicket({ order, onClose, nav }: { order: OrderState; onClose: () => void; nav: ChatNav }) {
  const symbol = order.symbol;
  const asset = assetBySymbol(symbol);
  const d = displayFor(symbol, asset?.name);
  const tradable = !!asset && isTradable(symbol) && !d.coming;
  // Live two-way gate: never let someone BUY a name with no sell route (LiFi's
  // books can be one-directional). Sells stay open — an exit is never blocked
  // by this, only entries. Unknown sweep (ok === null) fails open.
  const { data: trad } = useTradability();
  const buyBlocked =
    !!asset && (asset.tier === "stock" || asset.tier === "etf") &&
    trad?.ok != null && !trad.ok.includes(symbol);

  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const cash = bal?.value ?? 0;
  const holding = port?.holdings.find((h) => h.asset.symbol === symbol);

  const [side, setSide] = useState<"buy" | "sell">(order.side);
  // Sub-minimum acknowledgement: reset whenever side or symbol changes.
  const [underMinAck, setUnderMinAck] = useState(false);
  useEffect(() => { setUnderMinAck(false); }, [side, symbol]);
  // Chat handoff: "buy $25 of AAPL" arrives with the amount already set.
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
  const swap = useSwap();
  const n = parseFloat(amt) || 0;

  const { priceUsd: livePrice } = usePrice(symbol);
  const price = livePrice ?? holding?.priceUsd ?? d.price;

  // ── sell sizing (mirrors TradeScreen: typed dollars → raw units, no dust) ──
  const dec = asset?.decimals ?? 18;
  const heldRaw = holding?.raw ?? BigInt(0);
  const posUsd = holding?.valueUsd ?? (holding && price ? holding.qty * price : 0);
  const sellRaw = (() => {
    if (side !== "sell" || !holding || heldRaw <= BigInt(0)) return BigInt(0);
    if (!price || price <= 0 || n <= 0) return BigInt(0);
    const qtyWanted = n / price;
    // At or past the whole position: sell exactly what's held (no dust).
    if (qtyWanted >= holding.qty) return heldRaw;
    try {
      return parseUnits(qtyWanted.toFixed(Math.min(dec, 18)), dec);
    } catch {
      return BigInt(0);
    }
  })();

  // ── quotes (exact same hooks as TradeScreen) ──
  const { data: quote, isFetching: quoteFetching } = useQuote(
    side === "buy" && tradable && asset ? asset : null,
    n,
    address ?? undefined,
  );
  const { data: sellQuote, isFetching: sellFetching } = useSellQuote(
    side === "sell" && tradable && asset ? asset : null,
    side === "sell" ? sellRaw : BigInt(0),
    address ?? undefined,
  );

  const over = side === "buy" && n > cash + 1e-6;
  const canBuy = side === "buy" && tradable && n > 0 && !over && !!quote && quote.expectedOutRaw > BigInt(0) && !!address;
  const canSell = side === "sell" && tradable && sellRaw > BigInt(0) && !!sellQuote && sellQuote.expectedUsdcRaw > BigInt(0) && !!address;
  const readyBase = side === "buy" ? canBuy && !buyBlocked : canSell;

  // RFQ makers enforce their minimum only at fill time — warn, don't forbid.
  const underMin =
    side === "buy"
      ? quote?.kind === "rfq" && n > 0 && n < RFQ_MIN_BUY_USD
      : sellQuote?.kind === "rfq" && (sellQuote?.expectedUsd ?? 0) > 0 && (sellQuote?.expectedUsd ?? 0) < RFQ_MIN_SELL_USD;
  const minUsd = side === "buy" ? RFQ_MIN_BUY_USD : RFQ_MIN_SELL_USD;
  const ready = readyBase && (!underMin || underMinAck);

  const shares =
    side === "sell"
      ? fromUnits(sellRaw, dec).toFixed(3)
      : quote && quote.expectedOutQty > 0
        ? quote.expectedOutQty.toFixed(3)
        : price && price > 0
          ? (n / price).toFixed(3)
          : "0";
  const avail = side === "sell" ? `${usd(posUsd)} owned` : `${usd(cash)} available`;

  // Why the CTA can't fire — shown inline under the button, in plain words.
  const reason = !tradable
    ? "This one can't be traded in-app yet."
    : side === "buy" && buyBlocked
      ? "No sell route at the venues right now — buying is paused so you can't get stuck holding it."
    : side === "buy"
      ? n <= 0
        ? "Enter an amount"
        : over
          ? `That's more than your ${usd(cash)} cash`
          : quoteFetching && !quote
            ? "Getting a live price…"
            : quote?.noLiquidity
              ? "No price for this size right now — try another amount."
              : null
      : !holding || heldRaw <= BigInt(0)
        ? "You don't own this yet — buy some first."
        : sellRaw <= BigInt(0)
          ? "Enter an amount"
          : sellFetching && !sellQuote
            ? "Getting a live price…"
            : sellQuote?.noLiquidity
              ? "No price for this size right now — try a smaller amount."
              : null;

  const switchSide = (s: "buy" | "sell") => {
    if (swap.busy || s === side) return;
    haptic.select();
    setSide(s);
    setAmt("");
    swap.reset();
  };

  const submit = () => {
    if (swap.busy || !asset || !ready) return;
    haptic.medium();
    if (side === "buy") {
      void swap.buy({ asset, amountUsd: n });
      return;
    }
    if (!sellQuote) return;
    void swap.sell({ asset, amountIn: sellRaw, estUsdcValue: sellQuote.expectedUsd });
  };

  // Escape closes (the X always works — a signed trade finishes on-chain anyway).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !swap.busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swap.busy, close]);

  const done = swap.phase === "done" && swap.result;

  return (
    <div
      className={closing ? "fadein fadeout" : "fadein"}
      onClick={() => {
        if (!swap.busy) close();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(8,14,10,.22)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        className={closing ? "glassin glassout" : "glassin"}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 55%),var(--panel)", backdropFilter: "blur(14px) saturate(170%)", WebkitBackdropFilter: "blur(14px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 24, boxShadow: "0 24px 70px rgba(8,20,12,.34)", overflow: "hidden" }}
      >
        {/* header: side toggle + close */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0 16px" }}>
          <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 999, padding: 3, gap: 2 }}>
            <button
              onClick={() => switchSide("buy")}
              style={{ height: 32, padding: "0 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, background: side === "buy" ? "var(--bg)" : "transparent", boxShadow: side === "buy" ? "0 1px 4px rgba(12,32,20,.14)" : "none", color: side === "buy" ? "var(--primary)" : "var(--ink-3)" }}
            >
              Buy
            </button>
            <button
              onClick={() => switchSide("sell")}
              style={{ height: 32, padding: "0 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, background: side === "sell" ? "var(--bg)" : "transparent", boxShadow: side === "sell" ? "0 1px 4px rgba(12,32,20,.14)" : "none", color: side === "sell" ? "var(--neg)" : "var(--ink-3)" }}
            >
              Sell
            </button>
          </div>
          <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>

        {done && swap.result ? (
          // ── success (per the hook's phases; honest about a still-settling fill) ──
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 22px 22px", textAlign: "center" }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--primary)", display: "grid", placeItems: "center" }}>
              <PIcon name="ph-check" size={30} weight="bold" style={{ color: "var(--primary-ink)" }} />
            </div>
            <div className="serif" style={{ fontSize: 22, fontWeight: 500, marginTop: 12 }}>
              {swap.result.pending ? (swap.result.side === "sell" ? "Selling" : "Buying") : swap.result.side === "sell" ? "Sold" : "Bought"}
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.55 }}>
              {usd(swap.result.amountUsd)} of {d.name}
              {swap.result.side === "sell" ? " back to cash" : ""}
              {swap.result.pending
                ? " — placed and on-chain. Some stocks take a few minutes to settle."
                : " — done, gasless as always."}
            </p>
            {/* receipt — what left vs what arrived, with the tx on Blockscout */}
            {(() => {
              const r = swap.result;
              const usdgLogo = displayFor("USDG").logo;
              const qty = (raw: bigint, dp: number) => {
                const n = Number(fromUnits(raw, dp));
                return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
              };
              const sent = r.side === "buy"
                ? { logo: usdgLogo, text: `${usd(r.amountUsd)} USDG` }
                : { logo: d.logo, text: `≈ ${usd(r.amountUsd)} of ${symbol}` };
              const got = r.buyAmount !== undefined
                ? r.side === "buy"
                  ? { logo: d.logo, text: `≈ ${qty(r.buyAmount, asset?.decimals ?? 18)} ${symbol}` }
                  : { logo: usdgLogo, text: `≈ ${usd(Number(fromUnits(r.buyAmount, 6)))} USDG` }
                : null;
              const row = (label: string, x: { logo?: string; text: string }) => (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                  <span style={{ color: "var(--ink-2)" }}>{label}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 650 }}>
                    {x.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={x.logo} alt="" width={18} height={18} style={{ borderRadius: 6, flex: "none" }} />
                    ) : null}
                    {x.text}
                  </span>
                </div>
              );
              return (
                <div style={{ width: "100%", marginTop: 14, padding: "12px 14px", borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
                  {row(r.side === "buy" ? "You paid" : "You sold", sent)}
                  {got ? row(r.pending ? "You'll receive" : "You received", got) : null}
                  <a
                    href={`https://robinhoodchain.blockscout.com/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--primary)", marginTop: 2 }}
                  >
                    <PIcon name="ph-arrow-square-out" size={13} weight="bold" /> {r.txHash.slice(0, 10)}…{r.txHash.slice(-6)} on Blockscout
                  </a>
                </div>
              );
            })()}
            <button
              onClick={() => {
                nav.openCanvas("portfolio");
                close();
              }}
              style={{ width: "100%", height: 48, marginTop: 18, borderRadius: 16, fontSize: 14.5, fontWeight: 700, color: "var(--primary-ink)", background: "var(--primary)" }}
            >
              View portfolio
            </button>
            <button onClick={close} style={{ width: "100%", height: 42, marginTop: 8, borderRadius: 16, fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)", background: "var(--panel-2)" }}>
              Done
            </button>
          </div>
        ) : (
          // ── the ticket ──
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 22px 22px", textAlign: "center" }}>
            <AssetTile asset={d} size={46} radius={14} />
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 10 }}>{d.name}</div>
            <div className="tnum" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
              {symbol} · {price !== undefined && price > 0 ? priceStr(price) : "—"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 3, marginTop: 16 }}>
              <span className="serif" style={{ fontSize: 24, color: "var(--ink-3)" }}>$</span>
              <input
                value={amt}
                onChange={(e) => {
                  setAmt(clean(e.target.value));
                  if (swap.error) swap.reset();
                }}
                inputMode="decimal"
                placeholder="0"
                autoFocus
                aria-label={`Amount to ${side} in dollars`}
                className="serif tnum"
                style={{ width: 150, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 44, fontWeight: 500, letterSpacing: "-.02em", textAlign: "center" }}
              />
            </div>
            <div className="tnum" style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
              ≈ {shares} shares · {avail}
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    const base = side === "sell" ? posUsd : cash;
                    setAmt((Math.floor(base * p.f * 100) / 100).toFixed(2));
                    if (swap.error) swap.reset();
                  }}
                  style={{ height: 32, padding: "0 15px", border: "1px solid var(--line)", borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: "transparent", color: "var(--ink-2)" }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {underMin && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", cursor: "pointer" }}>
                <input type="checkbox" checked={underMinAck} onChange={(e) => setUnderMinAck(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--primary)" }} />
                <span style={{ fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  Orders under ${minUsd} are often turned down by the market maker. I understand this one may not fill.
                </span>
              </label>
            )}

            {swap.error && (
              <button
                onClick={swap.reset}
                style={{ width: "100%", marginTop: 12, background: "color-mix(in srgb,var(--neg) 10%,transparent)", border: "1px solid color-mix(in srgb,var(--neg) 30%,transparent)", borderRadius: 12, padding: "10px 13px", fontSize: 12.5, color: "var(--neg)", textAlign: "left", lineHeight: 1.5 }}
              >
                {friendly(swap.error)}
              </button>
            )}

            <button
              onClick={submit}
              disabled={!ready || swap.busy}
              style={{ width: "100%", height: 52, marginTop: 18, borderRadius: 16, fontSize: 15.5, fontWeight: 700, color: "#fff", background: side === "sell" ? "var(--neg)" : "var(--primary)", opacity: ready || swap.busy ? 1 : 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {swap.busy ? (
                <>
                  <CircleNotch size={17} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} />
                  {swap.settling ? "Settling…" : side === "buy" ? "Placing order…" : "Selling…"}
                </>
              ) : (
                `${side === "sell" ? "Sell" : "Buy"} ${usd(n)}`
              )}
            </button>
            {!swap.busy && !ready && reason && (
              <div style={{ fontSize: 12, color: over ? "var(--neg)" : "var(--ink-3)", marginTop: 9 }}>{reason}</div>
            )}
            {swap.settling && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 9, lineHeight: 1.5 }}>
                Placed and on-chain — you can close this; it finishes settling on its own.
              </div>
            )}

            <button
              onClick={() => {
                nav.askVera(`Help me decide how much ${d.name} (${symbol}) to ${side} — give me your honest take and a few amount options`);
                close();
              }}
              style={{ width: "100%", height: 44, marginTop: 9, borderRadius: 16, fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)", background: "none", border: "1px dashed var(--line)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              <PIcon name="ph-sparkle" size={15} weight="fill" style={{ color: "var(--primary)" }} /> Ask Vera instead
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)", marginTop: 12 }}>
              <PIcon name="ph-lock-key" size={13} weight="fill" style={{ color: "var(--primary)" }} /> Self-custody · price includes spread · gas on us
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
