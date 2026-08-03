"use client";

// The Grove exit popup. Sells a share of the position back to USDG in one
// sponsored transaction, all or nothing.
//
// The fee row is the most important line in this product: 10% of profit only,
// zero at a loss. It flips visually between the two cases instead of hiding
// either — profit shows the fee in plain mono, no profit collapses to a muted
// "no profit, no fee". Never hidden, never a range.
import { useCallback, useEffect, useRef, useState } from "react";
import { useGroveExit } from "@/hooks/useGroveExit";
import type { GroveLive } from "@/hooks/useGroves";
import { GroveModal, ModalSuccessIcon, ModalWorking, ReceiptRow, TrustCaption, ModalButtons, ModalDoneButton } from "./GroveModal";
import { usd, dcol } from "./chatKit";

const CHOICES = [
  { bps: 2500, label: "25%" },
  { bps: 5000, label: "50%" },
  { bps: 7500, label: "75%" },
  { bps: 10_000, label: "All" },
];

export function GroveExitPanel({ g, onClose }: { g: GroveLive; onClose: () => void }) {
  const [fractionBps, setFractionBps] = useState(10_000);
  const { phase, busy, error, quote, success, shortfall, getQuote, exit, closePosition } = useGroveExit();

  // Re-quote ONLY when the fraction changes. `busy` stays OUT of the deps —
  // depending on it makes every quote schedule the next one (busy cycles per
  // quote) and the panel requotes forever. Read through a ref at fire time so
  // a quote still never starts mid-transaction.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busyRef.current) return;
      void getQuote(g.id, fractionBps);
    }, 300);
    return () => clearTimeout(t);
  }, [fractionBps, g.id, getQuote]);

  const onExit = useCallback(() => void exit(g.id, fractionBps), [exit, g.id, fractionBps]);
  const onClear = useCallback(() => {
    if (g.onChainId !== undefined) void closePosition(g.id, g.onChainId);
  }, [closePosition, g.id, g.onChainId]);

  const fresh = quote && quote.groveId === g.id && quote.fractionBps === fractionBps;
  const minUsd = fresh ? Number(quote.minProceedsUsdg) / 1e6 : 0;
  const expectedUsd = fresh ? Number(quote.expectedProceedsUsdg) / 1e6 : 0;
  const feeUsd = fresh ? Number(quote.estimatedFeeUsdg) / 1e6 : 0;
  const basisUsd = fresh ? Number(quote.basisWithdrawnUsdg) / 1e6 : 0;
  const pnl = expectedUsd - basisUsd;
  const netUsd = expectedUsd - feeUsd;

  const phaseLabel =
    ({ quoting: "Pricing…", signing: "Waiting for your signature…", exiting: "Selling…", clearing: "Clearing…" } as Record<string, string>)[
      phase
    ] ?? null;

  const done = Boolean(success);

  // The transaction-out beats get the staking dialog's treatment: the form
  // disappears behind a spinner + live step, then the check POPS on success.
  const working = phase === "signing" || phase === "exiting" || phase === "clearing";

  return (
    <GroveModal title={done ? (success?.cleared ? "Cleared" : "Sold") : `Exit ${g.name}`} onClose={onClose} busy={busy}>
      {working ? (
        <ModalWorking
          title={phase === "clearing" ? "Clearing the position" : `Selling ${g.name}`}
          step={phaseLabel}
          // Clearing sells nothing, so it keeps the plain spinner.
          symbols={phase === "clearing" ? undefined : quote?.legs.map((l) => l.symbol)}
        />
      ) : done && success ? (
        <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <ModalSuccessIcon />
          <div className="serif" style={{ fontSize: 20, fontWeight: 500 }}>
            {success.cleared ? "Position cleared" : success.fractionBps === 10_000 ? "Position closed" : `Sold ${success.fractionBps / 100}%`}
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 12px", lineHeight: 1.55 }}>
            {success.cleared ? (
              <>Nothing was sold and no fee was charged — the Grove&rsquo;s accounting for this position is now zero. Any remaining tokens are still in your wallet.</>
            ) : (
              <>
                About <span className="tnum">{usd(success.expectedUsd)}</span> back in USDG
                {success.feeUsd > 0
                  ? <>, after <span className="tnum">{usd(success.feeUsd)}</span> in performance fee.</>
                  : ". No fee, there was no profit to charge on."}
              </>
            )}
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
          {/* ── how much ── */}
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
            How much to sell
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {CHOICES.map((c) => {
              const on = c.bps === fractionBps;
              // Once the server has told us the wallet only covers part of the
              // position, gray out the shares it cannot cover instead of letting
              // the user bounce off the same error again.
              const uncovered = shortfall !== null && c.bps > shortfall.maxFractionBps;
              return (
                <button
                  key={c.bps}
                  onClick={() => setFractionBps(c.bps)}
                  disabled={busy || uncovered}
                  className="tnum"
                  style={{
                    flex: 1,
                    height: 38,
                    borderRadius: 11,
                    fontSize: 13,
                    fontWeight: 700,
                    border: on ? "1px solid var(--ink-2)" : "1px solid var(--line)",
                    background: on ? "var(--panel-2)" : "transparent",
                    color: on ? "var(--ink)" : "var(--ink-3)",
                    cursor: busy || uncovered ? "default" : "pointer",
                    opacity: uncovered ? 0.4 : 1,
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* ── receipt ── */}
          {fresh && (
            <div style={{ margin: "12px 2px 0" }}>
              <ReceiptRow k="Cost basis withdrawn" v={usd(basisUsd)} muted />
              <ReceiptRow k="Expected proceeds" v={usd(expectedUsd)} />
              <ReceiptRow k="Guaranteed minimum" v={usd(minUsd)} muted />
              <ReceiptRow k="Profit / loss" v={`${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`} color={dcol(pnl)} />
              {feeUsd >= 0.005 ? (
                <ReceiptRow k={`Exit fee, ${g.feeBps / 100}% of profit`} v={`− ${usd(feeUsd)}`} />
              ) : feeUsd > 0 ? (
                <ReceiptRow k={`Exit fee, ${g.feeBps / 100}% of profit`} v="under $0.01" muted />
              ) : (
                <ReceiptRow k="Exit fee" v="$0.00 · no profit, no fee" muted />
              )}
              <ReceiptRow k="You receive, estimate" v={usd(netUsd)} strong />
            </div>
          )}

          {fresh && fractionBps === 10_000 && (
            <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 10 }}>
              Selling all closes the position: every holding is sold to zero.
            </div>
          )}

          {shortfall ? (
            <div style={{ marginTop: 10, padding: "12px 13px", borderRadius: 13, border: "1px solid var(--line)", background: "var(--panel-2)" }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>{shortfall.message}</div>
              <button
                onClick={onClear}
                disabled={busy || g.onChainId === undefined}
                style={{ width: "100%", height: 40, marginTop: 10, borderRadius: 11, fontSize: 13, fontWeight: 700, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)", cursor: busy ? "default" : "pointer" }}
              >
                Clear position · no swap, no fee
              </button>
              <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 7 }}>
                Clearing zeroes this Grove&rsquo;s accounting without selling anything. Tokens you still hold stay in your wallet — you can sell those from your portfolio like any other stock.
              </div>
            </div>
          ) : (
            error && (
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--neg)", marginTop: 10 }}>{error}</div>
            )
          )}

          <TrustCaption>USDG lands in your own wallet, whole or not at all</TrustCaption>
          <ModalButtons
            confirmLabel={fractionBps === 10_000 ? "Sell everything" : `Sell ${fractionBps / 100}%`}
            onConfirm={onExit}
            disabled={busy || !fresh}
            busyLabel={phaseLabel}
          />
        </>
      )}
    </GroveModal>
  );
}
