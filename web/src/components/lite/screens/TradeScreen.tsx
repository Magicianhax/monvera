"use client";

// Trade — Pro manual buy/sell (screens_pro.jsx · Trade) wired to the REAL gasless
// path. BUY: useQuote (live Fluxion/Agni spot) + useSwap.buy (batched approve +
// swap as one sponsored UserOp). SELL: useSellQuote + useSwap.sell (the held
// token -> USDC, recipient = user) — single-hop Fluxion for stocks, reversed
// Agni route for sUSDe/mETH. The slippage tolerance maps Tight / Normal / Loose
// to 50 / 100 / 300 bps (the on-chain amountOutMinimum is the real protection).
// On success we route to the plain-words receipt.
import { useEffect, useState } from "react";
import { ALL_ASSETS, isTradable, type Asset } from "@/lib/tokens";
import { useQuote, useSellQuote } from "@/hooks/useQuote";
import { useSwap } from "@/hooks/useSwap";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { usePrice } from "@/hooks/usePrices";
import { useMarketHistory } from "@/hooks/useMarket";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { displayFor } from "@/lib/displayAssets";
import { Icon, AssetTile, BottomSheet, Crossfade, CountUp, PriceChart } from "@/components/design";
import { usd, tokenQty, fromUnits } from "@/lib/format";
import { iconBtn, Spinner } from "./primitives";

const BPS = BigInt(10000);

const TOL_BPS = [50, 100, 300]; // Tight / Normal / Loose
const TOL_LABELS = ["Tight", "Normal", "Loose"];
const TOL_PCT = ["0.5%", "1.0%", "3.0%"];

export function TradeScreen({
  go,
  symbol,
  initialSide = "buy",
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol: string;
  initialSide?: "buy" | "sell";
}) {
  const asset: Asset = ALL_ASSETS.find((a) => a.symbol === symbol) ?? ALL_ASSETS[0];
  const d = displayFor(asset.symbol, asset.name);
  // Sellable = anything with a validated swap route (stocks via Fluxion,
  // mETH via its reversed Agni route). `coming` assets (e.g. sUSDe, whose pool
  // lost liquidity) are never buyable or sellable, even if a route entry exists.
  const sellable = isTradable(asset.symbol) && !d.coming;
  // Real market context: live on-chain spot + real 1D move/series, with the
  // presentational reference as the offline fallback.
  const { priceUsd: livePrice, isLoading: priceLoading } = usePrice(asset.symbol);
  const { data: dayMarket, isLoading: marketLoading } = useMarketHistory(asset.symbol, "1D");
  // First-load gate: while either market query is in flight we show skeletons
  // instead of the offline fallback numbers (never a fallback dressed as real).
  const marketReady = !priceLoading && !marketLoading;
  const shownPrice = livePrice ?? d.price;
  const day = dayMarket?.changePct ?? d.day;
  const spark = dayMarket?.series ?? d.spark;
  const up = day >= 0;
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const balance = bal?.value ?? 0;
  const holding = port?.holdings.find((h) => h.asset.symbol === asset.symbol);

  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amt, setAmt] = useState("");
  const [tol, setTol] = useState(1);
  const [confirm, setConfirm] = useState(false);

  const n = parseFloat(amt) || 0;
  const { data: quote, isFetching } = useQuote(side === "buy" ? asset : null, n, address ?? undefined);
  const swap = useSwap();

  // Sell side: percentage of the held position to sell (default 100%).
  const [sellPct, setSellPct] = useState(100);
  const heldRaw = holding?.raw ?? BigInt(0);
  const sellRaw = (heldRaw * BigInt(Math.round(sellPct))) / BigInt(100);
  const sellQty = holding ? fromUnits(sellRaw, asset.decimals ?? 18) : 0;
  const { data: sellQuote, isFetching: sellFetching } = useSellQuote(
    side === "sell" && sellable ? asset : null,
    side === "sell" ? sellRaw : BigInt(0),
    address ?? undefined,
  );

  const over = side === "buy" && n > balance + 1e-6;
  const canBuy =
    side === "buy" && !d.coming && n > 0 && !over && !!quote && quote.expectedOutRaw > BigInt(0) && !!address;
  const canSell =
    side === "sell" &&
    sellable &&
    sellRaw > BigInt(0) &&
    !!sellQuote &&
    sellQuote.expectedUsdcRaw > BigInt(0) &&
    !!address;

  const dec = asset.decimals ?? 18;
  const tolBps = TOL_BPS[tol];
  // Slippage floor at the chosen tolerance — the guarantee we surface before executing.
  const buyMinOutRaw =
    quote && quote.expectedOutRaw > BigInt(0)
      ? (quote.expectedOutRaw * BigInt(10000 - tolBps)) / BPS
      : BigInt(0);
  const sellMinUsd = sellQuote ? sellQuote.expectedUsd * (1 - tolBps / 10000) : 0;
  // Why a disabled buy CTA can't fire — shown inline under the button.
  const buyReason =
    n <= 0 ? "Enter an amount" : over ? `Amount exceeds your ${usd(balance)} cash` : null;

  // On a filled buy/sell, jump to the plain-words receipt.
  useEffect(() => {
    if (swap.phase === "done" && swap.result) {
      const isSell = swap.result.side === "sell";
      go("receipt", {
        title: `${isSell ? "Sold" : "Bought"} ${swap.result.asset.name}`,
        amount: isSell ? swap.result.amountUsd : -swap.result.amountUsd,
        txHash: swap.result.txHash,
      });
    }
  }, [swap.phase, swap.result, go]);

  const submit = () => {
    if (side === "buy") {
      if (!quote || !address) return;
      void swap.buy({ asset, amountUsd: n });
      return;
    }
    // sell
    if (!sellQuote || !address) return;
    void swap.sell({ asset, amountIn: sellRaw, estUsdcValue: sellQuote.expectedUsd });
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 4 }}>
          <AssetTile asset={d} size={30} />
          <h1 style={{ margin: 0, fontWeight: 600, fontSize: 17, letterSpacing: "-.01em" }}>{d.name}</h1>
        </div>
      </div>

      {/* price + market context — centered focal block above the chart */}
      {!marketReady ? (
        <>
          <div
            style={{
              padding: "12px 22px 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div className="skeleton" style={{ width: 132, height: 28, borderRadius: 5 }} />
            <div className="skeleton" style={{ width: 96, height: 14, borderRadius: 5 }} />
          </div>
          <div style={{ padding: "10px 22px 2px" }}>
            <div className="skeleton" style={{ width: "100%", height: 120, borderRadius: 6 }} />
          </div>
        </>
      ) : (
        <>
          <div className="anim-rise" style={{ padding: "12px 22px 0", textAlign: "center" }}>
            <div className="tnum" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>
              {shownPrice !== undefined ? <CountUp to={shownPrice} /> : "—"}
            </div>
            <div
              className="tnum"
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginTop: 2,
                color: up ? "var(--pos)" : "var(--neg)",
              }}
            >
              {(up ? "+" : "") + day.toFixed(2)}% today
            </div>
          </div>
          <div className="anim-rise" style={{ animationDelay: ".05s", padding: "10px 22px 2px" }}>
            <PriceChart
              data={spark}
              up={up}
              height={120}
              label={`${d.name} price chart, ${up ? "up" : "down"} ${Math.abs(day).toFixed(1)}% today`}
            />
          </div>
        </>
      )}

      {/* buy/sell toggle — sliding-thumb segmented control */}
      <div style={{ padding: "16px 22px 0" }}>
        <div className="seg">
          <span
            className="seg-thumb"
            style={{
              width: "calc((100% - 8px) / 2)",
              left: 4,
              transform: `translateX(${side === "sell" ? "100%" : "0"})`,
            }}
          />
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`seg-item ${side === s ? "is-on" : ""}`}
              style={{ textTransform: "capitalize" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {side === "sell" && (!sellable || !holding || heldRaw <= BigInt(0)) ? (
        <div
          className="anim-rise"
          style={{ padding: "40px 30px 0", textAlign: "center", color: "var(--ink-2)" }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 6,
              background: "var(--surface-2)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              margin: "0 auto 16px",
            }}
          >
            <Icon name="clock" size={28} />
          </div>
          <div style={{ fontSize: 16.5, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
            {!holding || heldRaw <= BigInt(0) ? "Nothing to sell here" : "Selling is coming soon"}
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55 }}>
            {!holding || heldRaw <= BigInt(0)
              ? "You don't own this yet. Buy some first, then you can sell any time."
              : "One-tap selling for this asset is on the way. For now, ask Vera to rebuild your plan."}
          </p>
        </div>
      ) : side === "sell" ? (
        <>
          {/* sell amount */}
          <div className="anim-rise" style={{ padding: "30px 22px 0", textAlign: "center" }}>
            <div
              className="tnum"
              style={{ fontSize: 50, fontWeight: 600, letterSpacing: "-.04em" }}
            >
              {sellFetching && !sellQuote ? (
                <span
                  className="skeleton"
                  style={{ display: "inline-block", width: 150, height: 44, borderRadius: 6, verticalAlign: "middle" }}
                  aria-label="Getting a price"
                />
              ) : sellQuote ? (
                <CountUp to={sellQuote.expectedUsd} />
              ) : (
                "—"
              )}
            </div>
            <div className="tnum" style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
              {`Selling ${tokenQty(sellRaw, asset.decimals ?? 18)} ${d.ticker ?? asset.symbol}`}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
              {`You own ${tokenQty(heldRaw, asset.decimals ?? 18)}`}
            </div>
          </div>

          {/* sell percentage */}
          <div style={{ display: "flex", gap: 8, padding: "18px 22px 0", justifyContent: "center" }}>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                className={`chip tap ${sellPct === p ? "is-dark" : ""}`}
                onClick={() => setSellPct(p)}
                style={{ height: 38 }}
              >
                {p === 100 ? "All" : `${p}%`}
              </button>
            ))}
          </div>

          {/* tolerance */}
          <div style={{ padding: "18px 22px 0" }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-2)" }}>
                  Price movement I&apos;ll allow
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {TOL_PCT[tol]}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {TOL_LABELS.map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setTol(i)}
                    className={`chip tap ${tol === i ? "is-dark" : ""}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {sellQuote && (
            <div
              style={{
                padding: "10px 22px 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              <span>You&apos;ll receive at least</span>
              <span className="tnum" style={{ fontWeight: 500, color: "var(--ink)" }}>
                {usd(sellMinUsd)}
              </span>
            </div>
          )}

          {swap.error && (
            <div style={{ padding: "14px 22px 0" }}>
              <div
                onClick={swap.reset}
                className="tap"
                style={{
                  background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
                  color: "var(--neg)",
                  padding: "11px 14px",
                  borderRadius: "var(--rr)",
                  fontSize: 13.5,
                  fontWeight: 500,
                }}
              >
                {swap.error}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />
          <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
            <div style={{ textAlign: "center", marginBottom: 12, fontSize: 12.5, color: "var(--ink-3)" }}>
              Gas-free · price includes the quoted spread · paid into your cash
            </div>
            <button
              className="btn btn-primary btn-block btn-lg tap"
              disabled={!canSell || swap.busy}
              onClick={() => setConfirm(true)}
            >
              <Crossfade
                showFirst={swap.busy}
                style={{ alignItems: "center" }}
                first={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <Spinner small /> Selling…
                  </span>
                }
                second={<span>Sell{sellQuote ? ` for ${usd(sellQuote.expectedUsd)}` : ""}</span>}
              />
            </button>
            {!swap.busy && !canSell && (!sellQuote || sellFetching) && (
              <div style={{ textAlign: "center", marginTop: 10, fontSize: 12.5, color: "var(--ink-3)" }}>
                Getting a price…
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* amount — the big number IS the input (tap to type a custom amount) */}
          <div className="anim-rise" style={{ padding: "30px 22px 0", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline" }}>
              <span
                className="tnum"
                style={{ fontSize: 56, fontWeight: 600, letterSpacing: "-.04em", color: amt ? "var(--ink)" : "var(--ink-3)" }}
              >
                $
              </span>
              <input
                inputMode="decimal"
                autoFocus
                placeholder="0"
                value={amt}
                onChange={(e) => {
                  // digits + a single decimal point only
                  const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                  setAmt(v);
                  if (swap.error) swap.reset();
                }}
                aria-label="Amount to buy in dollars"
                className="tnum"
                style={{
                  fontSize: 56,
                  fontWeight: 600,
                  letterSpacing: "-.04em",
                  color: amt ? "var(--ink)" : "var(--ink-3)",
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  padding: 0,
                  textAlign: "left",
                  width: `${Math.max(1, (amt || "0").length)}ch`,
                  caretColor: "var(--primary)",
                }}
              />
            </div>
            <div className="tnum" style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4 }}>
              {isFetching && !quote
                ? "Getting a live price…"
                : quote && quote.expectedOutRaw > BigInt(0)
                  ? `≈ ${tokenQty(quote.expectedOutRaw, asset.decimals ?? 18)} shares`
                  : shownPrice !== undefined
                    ? `${usd(shownPrice)} each`
                    : ""}
            </div>
            <div
              style={{ fontSize: 12.5, color: over ? "var(--neg)" : "var(--ink-2)", marginTop: 4 }}
            >
              {usd(balance)} available
            </div>
          </div>

          {/* quick amounts — percentages of the available balance (so they scale
              with what you actually have, not fixed dollar buttons) */}
          <div style={{ display: "flex", gap: 8, padding: "18px 22px 0", justifyContent: "center" }}>
            {[25, 50, 75].map((pct) => {
              const str = (Math.floor(balance * pct) / 100).toFixed(2);
              return (
                <button
                  key={pct}
                  className={`chip tap ${amt === str ? "is-dark" : ""}`}
                  onClick={() => setAmt(str)}
                  style={{ height: 38 }}
                >
                  {pct}%
                </button>
              );
            })}
            <button
              className={`chip tap ${amt === (Math.floor(balance * 100) / 100).toFixed(2) ? "is-dark" : ""}`}
              onClick={() => setAmt((Math.floor(balance * 100) / 100).toFixed(2))}
              style={{ height: 38 }}
            >
              Max
            </button>
          </div>

          {/* tolerance */}
          <div style={{ padding: "18px 22px 0" }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-2)" }}>
                  Price movement I&apos;ll allow
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {TOL_PCT[tol]}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {TOL_LABELS.map((t, i) => (
                  <button
                    key={t}
                    onClick={() => setTol(i)}
                    className={`chip tap ${tol === i ? "is-dark" : ""}`}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {quote && quote.expectedOutRaw > BigInt(0) && (
            <div
              style={{
                padding: "10px 22px 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              <span>You&apos;ll receive at least</span>
              <span className="tnum" style={{ fontWeight: 500, color: "var(--ink)" }}>
                {tokenQty(buyMinOutRaw, dec)} shares
              </span>
            </div>
          )}

          {swap.error && (
            <div style={{ padding: "14px 22px 0" }}>
              <div
                onClick={swap.reset}
                className="tap"
                style={{
                  background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
                  color: "var(--neg)",
                  padding: "11px 14px",
                  borderRadius: "var(--rr)",
                  fontSize: 13.5,
                  fontWeight: 500,
                }}
              >
                {swap.error}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />
          <div style={{ padding: "12px 22px calc(18px + env(safe-area-inset-bottom))" }}>
            <div style={{ textAlign: "center", marginBottom: 12, fontSize: 12.5, color: "var(--ink-3)" }}>
              Gas-free · price includes the quoted spread
            </div>
            <button
              className="btn btn-primary btn-block btn-lg tap"
              disabled={!canBuy || swap.busy}
              onClick={() => setConfirm(true)}
            >
              <Crossfade
                showFirst={swap.busy}
                style={{ alignItems: "center" }}
                first={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <Spinner small /> Placing order…
                  </span>
                }
                second={<span>Buy {n ? usd(n) : ""}</span>}
              />
            </button>
            {!swap.busy && buyReason && (
              <div
                style={{
                  textAlign: "center",
                  marginTop: 10,
                  fontSize: 12.5,
                  color: over ? "var(--neg)" : "var(--ink-3)",
                }}
              >
                {buyReason}
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirm summary — the deliberate commit step before we fire the swap. */}
      <BottomSheet
        open={confirm}
        onClose={() => {
          if (!swap.busy) setConfirm(false);
        }}
        title={side === "buy" ? "Review your buy" : "Review your sale"}
      >
        <div className="card" style={{ padding: "4px 16px", marginBottom: 16 }}>
          {side === "buy" ? (
            <>
              <ReviewRow label="You spend" value={usd(n)} />
              <ReviewRow
                label="Estimated shares"
                value={`${tokenQty(quote?.expectedOutRaw ?? BigInt(0), dec)} shares`}
              />
              <ReviewRow
                label="You'll receive at least"
                value={`${tokenQty(buyMinOutRaw, dec)} shares`}
                strong
              />
            </>
          ) : (
            <>
              <ReviewRow
                label="You sell"
                value={`${tokenQty(sellRaw, dec)} ${d.ticker ?? asset.symbol}`}
              />
              <ReviewRow label="Estimated proceeds" value={usd(sellQuote?.expectedUsd ?? 0)} />
              <ReviewRow label="You'll receive at least" value={usd(sellMinUsd)} strong />
            </>
          )}
        </div>
        {swap.error && (
          <div
            onClick={swap.reset}
            className="tap"
            style={{
              background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
              color: "var(--neg)",
              padding: "11px 14px",
              borderRadius: "var(--rr)",
              fontSize: 13.5,
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            {swap.error}
          </div>
        )}
        <button
          className="btn btn-primary btn-block btn-lg tap"
          disabled={swap.busy || (side === "buy" ? !canBuy : !canSell)}
          onClick={submit}
        >
          <Crossfade
            showFirst={swap.busy}
            style={{ alignItems: "center" }}
            first={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <Spinner small /> {side === "buy" ? "Placing order…" : "Selling…"}
              </span>
            }
            second={<span>{side === "buy" ? "Confirm buy" : "Confirm sale"}</span>}
          />
        </button>
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12.5, color: "var(--ink-3)" }}>
          Gas-free · price includes the quoted spread
        </div>
      </BottomSheet>
    </div>
  );
}

// One label/value line in the pre-trade confirm summary.
function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "10px 0",
        borderTop: "1px solid var(--line)",
      }}
    >
      <span style={{ fontSize: 14, color: "var(--ink-2)" }}>{label}</span>
      <span
        className="tnum"
        style={{
          fontSize: strong ? 16 : 15,
          fontWeight: strong ? 700 : 600,
          color: "var(--ink)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
