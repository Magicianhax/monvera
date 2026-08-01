"use client";

// The Grove buy popup. One sponsored transaction into GroveManager.buy —
// distinct from the chat rails, which never touch the contract.
//
// Body structure (Copperx receipt idiom): amount card, then the per-leg
// receipt, then the quiet custody caption, then cancel/confirm. Every number
// shown is one the contract will enforce: the per-leg amounts are what it
// pulls, "at least" is the venue floor each leg reverts below.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGroveBuy } from "@/hooks/useGroveBuy";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import type { GroveLive } from "@/hooks/useGroves";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { GroveModal, ModalCard, ReceiptRow, TrustCaption, ModalButtons, ModalDoneButton } from "./GroveModal";
import { PIcon, usd } from "./chatKit";

/** Trim a token amount to something readable without lying about size. */
function tokenStr(raw: string): string {
  const n = Number(raw) / 1e18;
  if (!Number.isFinite(n)) return "0";
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toExponential(2);
}

export function GroveBuyPanel({ g, onClose }: { g: GroveLive; onClose: () => void }) {
  const wallet = useActiveWallet();
  const { data: bal } = useUsdcBalance(wallet?.address);
  const [amount, setAmount] = useState(String(Math.max(g.minBuyUsd, 100)));
  const { phase, busy, error, quote, success, getQuote, buy } = useGroveBuy();

  const cash = bal?.value ?? 0;
  const amountNum = Number(amount);
  const valid = Number.isFinite(amountNum) && amountNum >= g.minBuyUsd;
  // bal !== undefined, not cash > 0: a LOADED zero balance must block exactly
  // like any other insufficient balance, or the $0 user signs a doomed permit.
  const overCash = valid && bal !== undefined && amountNum > bal.value;

  // Price on a settle, not on every keystroke — each quote fans out to the
  // venue once per component.
  // Re-quote ONLY when the amount changes. `busy` must stay OUT of the deps:
  // every quote cycles busy false->true->false, so depending on it re-runs the
  // effect after each quote and the panel requotes forever, back to back, with
  // the confirm button flickering "Pricing" the whole time. It is read through
  // a ref at fire time instead, so a quote never starts mid-transaction.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(() => {
      if (busyRef.current) return;
      void getQuote(g.id, amountNum);
    }, 450);
    return () => clearTimeout(t);
  }, [valid, amountNum, g.id, getQuote]);

  // Fresh = the quote describes THIS amount. The server's totalInUsdg is the
  // exact split of floor(amount * 1e6), so the quote self-identifies and no
  // side-channel "what did I ask for" state is needed (which also makes this
  // immune to out-of-order fetch resolutions).
  const fresh =
    quote && quote.groveId === g.id && Number(quote.totalInUsdg) === Math.floor(amountNum * 1e6);
  const totalUsd = fresh ? Number(quote.totalInUsdg) / 1e6 : 0;

  const onBuy = useCallback(() => {
    if (valid && !overCash) void buy(g.id, amountNum);
  }, [valid, overCash, buy, g.id, amountNum]);

  const phaseLabel = useMemo(
    () =>
      ({
        quoting: "Pricing…",
        checking: "Checking the contract…",
        signing: "Waiting for your signature…",
        buying: "Buying…",
      })[phase as string] ?? null,
    [phase],
  );

  const done = Boolean(success);

  return (
    <GroveModal title={done ? "Bought" : `Buy ${g.name}`} onClose={onClose} busy={busy}>
      {done && success ? (
        // ── success (PaySheet "sent" idiom) ──
        <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--primary)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
            <PIcon name="ph-check" size={30} weight="bold" style={{ color: "var(--primary-ink, #fff)" }} />
          </div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 500 }}>{g.name} is yours</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 12px", lineHeight: 1.55 }}>
            <span className="tnum">{usd(success.totalUsd)}</span> across {success.legs.length} {success.legs.length === 1 ? "holding" : "holdings"}, settled in your own wallet.
            The only fee is {g.feeBps / 100}% of profit when you exit.
          </p>
          <a
            href={`https://robinhoodchain.blockscout.com/tx/${success.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            View transaction
          </a>
          <ModalDoneButton />
        </div>
      ) : (
        <>
          {/* ── amount ── */}
          <ModalCard>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              You pay
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: "var(--ink-3)" }}>$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                className="mono"
                aria-label="Amount in USDG"
                disabled={busy}
                style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 24, fontWeight: 600, color: busy ? "var(--ink-3)" : "var(--ink)" }}
              />
              {cash >= g.minBuyUsd && (
                <button
                  onClick={() => setAmount(String(Math.floor(cash)))}
                  disabled={busy}
                  style={{ flex: "none", padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink-2)", cursor: busy ? "default" : "pointer" }}
                >
                  Max
                </button>
              )}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: overCash ? "var(--neg)" : "var(--ink-3)", marginTop: 6 }}>
              {overCash
                ? `You have ${usd(cash)} in cash`
                : bal !== undefined
                  ? `Balance ${usd(cash)} · from ${usd(g.minBuyUsd)}`
                  : `From ${usd(g.minBuyUsd)}`}
            </div>
          </ModalCard>

          {/* ── what this buys ── */}
          {fresh && valid && (
            <ModalCard style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 2 }}>
                You receive
              </div>
              {quote.legs.map((l) => (
                <div key={l.symbol} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderTop: "1px solid var(--line-2)" }}>
                  <AssetTile asset={toTile(l.symbol)} size={20} radius={7} />
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{l.symbol}</span>
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>{usd(Number(l.amountIn) / 1e6)}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 86, textAlign: "right" }}>≥ {tokenStr(l.minOut)}</span>
                </div>
              ))}
              {quote.skipped.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5, paddingTop: 8, borderTop: "1px solid var(--line-2)" }}>
                  Skipped at this size: {quote.skipped.map((s) => s.symbol).join(", ")}. Small buys take the largest holdings first.
                </div>
              )}
            </ModalCard>
          )}

          {/* ── receipt ── */}
          {fresh && valid && (
            <div style={{ margin: "10px 2px 0" }}>
              <ReceiptRow k="Total" v={usd(totalUsd)} strong />
              <ReceiptRow k="Gas" v="sponsored" muted />
              <ReceiptRow k="Entry fee" v="none" muted />
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--neg)", marginTop: 10 }}>{error}</div>
          )}

          <TrustCaption>Settles in your own wallet, whole or not at all</TrustCaption>
          <ModalButtons
            confirmLabel={fresh && valid ? `Buy ${usd(totalUsd)}` : "Buy"}
            onConfirm={onBuy}
            disabled={!valid || overCash || busy || !fresh}
            busyLabel={phaseLabel}
          />
        </>
      )}
    </GroveModal>
  );
}
