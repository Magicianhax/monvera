"use client";

// The Grove buy popup. One sponsored transaction into GroveManager.buy —
// distinct from the chat rails, which never touch the contract.
//
// Body structure (Copperx receipt idiom): amount card, then the per-leg
// receipt, then the quiet custody caption, then cancel/confirm. Every number
// shown is one the contract will enforce: the per-leg amounts are what it
// pulls, "at least" is the venue floor each leg reverts below.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGroveBuy } from "@/hooks/useGroveBuy";
import { useGroveAutoState } from "@/hooks/useGroveAuto";
import { usePortfolio, useUsdcBalance } from "@/hooks/useBalances";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import type { GroveLive } from "@/hooks/useGroves";
import { assetBySymbol } from "@/lib/tokens";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { GroveModal, ModalCard, ModalSuccessIcon, ModalWorking, ReceiptRow, TrustCaption, ModalButtons, ModalDoneButton } from "./GroveModal";
import { isLegacyAutoConfig } from "@/lib/groveManager";
import { usd } from "./chatKit";

const GVBP_CSS = `
.gvbp-press{transition:transform .16s ease-out}
.gvbp-press:active{transform:scale(.97)}
@media (prefers-reduced-motion: reduce){.gvbp-press{transition:none}.gvbp-press:active{transform:none}}
`;

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
  const { data: port } = usePortfolio(wallet?.address);
  const [amount, setAmount] = useState(String(Math.max(g.minBuyUsd, 100)));
  // Managed is on by default for a FIRST buy: consent rides inside the same
  // signature. The tick is real — unticking buys unmanaged — so it may only
  // render where it is real: useGroveBuy never removes a standing consent, so
  // against a live AutoConfig the checkbox would be a silently ignored
  // control and a static note renders instead. Loading or errored config
  // reads also suppress it, and the buy then passes no autoManage at all
  // (the hook's already-enabled guard stays the backstop).
  const [autoOn, setAutoOn] = useState(true);
  const autoState = useGroveAutoState(g.onChainId);
  const standing = autoState.isSuccess && (autoState.data?.enabled ?? false);
  const standingLegacy = standing && !!autoState.data && isLegacyAutoConfig(autoState.data);
  const offerTick = autoState.isSuccess && !standing;
  const { phase, busy, error, quote, success, getQuote, buy } = useGroveBuy();

  // This buy's UserOp may have switched management on; the Managed card and a
  // re-opened buy panel must not show a stale "off" for the next 30s.
  const qc = useQueryClient();
  useEffect(() => {
    if (success?.autoEnabled) void qc.invalidateQueries({ queryKey: ["grove-auto"] });
  }, [success, qc]);

  const cash = bal?.value ?? 0;
  // Grove-exit proceeds park at the smart account and fund a re-buy FIRST
  // (useGroveBuy spends them before pulling from the EOA) — so the spendable
  // number here is BOTH pots, or a user re-entering after an exit is told
  // they have no money.
  const groveCash = port?.smartCashUsd ?? 0;
  const spendable = cash + groveCash;
  const amountNum = Number(amount);
  const valid = Number.isFinite(amountNum) && amountNum >= g.minBuyUsd;
  // bal !== undefined, not cash > 0: a LOADED zero balance must block exactly
  // like any other insufficient balance, or the $0 user signs a doomed permit.
  const overCash = valid && bal !== undefined && amountNum > spendable;

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
    if (!valid || overCash) return;
    const consent = offerTick && autoOn;
    const tokens = consent
      ? g.components.map((c) => assetBySymbol(c.symbol)?.address as `0x${string}` | undefined).filter((a): a is `0x${string}` => !!a)
      : [];
    void buy(g.id, amountNum, consent ? { tokens } : undefined);
  }, [valid, overCash, buy, g.id, amountNum, autoOn, offerTick, g.components]);

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

  // Transaction-out beats get the staking dialog's treatment: the form
  // disappears behind a spinner + live step, then the check POPS on success.
  const working = phase === "checking" || phase === "signing" || phase === "buying";

  return (
    <GroveModal title={done ? "Bought" : `Buy ${g.name}`} onClose={onClose} busy={busy}>
      <style>{GVBP_CSS}</style>
      {working ? (
        <ModalWorking
          title={`Buying ${g.name}`}
          step={phaseLabel}
          symbols={(quote?.legs.length ? quote.legs : undefined)?.map((l) => l.symbol)}
        />
      ) : done && success ? (
        // ── success (PaySheet "sent" idiom) ──
        <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <ModalSuccessIcon />
          <div className="serif" style={{ fontSize: 20, fontWeight: 500 }}>{g.name} is yours</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 12px", lineHeight: 1.55 }}>
            <span className="tnum">{usd(success.totalUsd)}</span> across {success.legs.length} {success.legs.length === 1 ? "holding" : "holdings"}, settled in your own wallet.
            The only fee is {g.feeBps / 100}% of profit when you exit.
            {success.autoEnabled
              ? " Vera is managing it, and you can stop that any time."
              : standing
                ? " It joins your managed position."
                : ""}
          </p>
          <a
            href={`https://robinhoodchain.blockscout.com/tx/${success.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono gvbp-press"
            style={{ display: "inline-block", fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            View transaction
          </a>
          <ModalDoneButton />
        </div>
      ) : (
        <>
          {/* ── amount ── */}
          <ModalCard>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)" }}>
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
              {spendable >= g.minBuyUsd && (
                <button
                  className="gvbp-press"
                  onClick={() => setAmount(String(Math.floor(spendable)))}
                  disabled={busy}
                  style={{ flex: "none", padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink-2)", cursor: busy ? "default" : "pointer" }}
                >
                  Max
                </button>
              )}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: overCash ? "var(--neg)" : "var(--ink-3)", marginTop: 6 }}>
              {overCash
                ? `You have ${usd(spendable)} to spend${groveCash >= 0.01 ? ` (incl. ${usd(groveCash)} in your Grove account)` : ""}`
                : bal !== undefined
                  ? `Balance ${usd(spendable)}${groveCash >= 0.01 ? ` · ${usd(groveCash)} from Grove exits used first` : ""} · from ${usd(g.minBuyUsd)}`
                  : `From ${usd(g.minBuyUsd)}`}
            </div>
          </ModalCard>

          {/* ── what this buys ── */}
          {fresh && valid && (
            <ModalCard style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)", marginBottom: 2 }}>
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
              <ReceiptRow k="Gas" v="on us" muted />
              <ReceiptRow k="Entry fee" v="none" muted />
            </div>
          )}

          {/* ── the consent slot: a checkbox only where the tick is real ── */}
          {offerTick ? (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 9, margin: "12px 2px 0", cursor: busy ? "default" : "pointer" }}>
              <input
                type="checkbox"
                checked={autoOn}
                disabled={busy}
                onChange={(e) => setAutoOn(e.target.checked)}
                style={{ marginTop: 2, width: 15, height: 15, accentColor: "var(--primary)" }}
              />
              <span style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>Managed by Vera</span>. She keeps this
                basket at its published weights, and every move is a public transaction. Off any time,
                instantly.
              </span>
            </label>
          ) : standingLegacy ? (
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-2)", margin: "12px 2px 0" }}>
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>Managed on an early, limited setting</span>.
              This deposit joins it. You can upgrade to full management in the Managed card.
            </div>
          ) : standing ? (
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-2)", margin: "12px 2px 0" }}>
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>Already managed</span>. This deposit joins
              your managed position; stop any time in the Managed card.
            </div>
          ) : autoState.isError ? (
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-3)", margin: "12px 2px 0" }}>
              Couldn&rsquo;t check whether this basket is managed. This buy leaves that unchanged; the Managed
              card can turn it on or off any time.
            </div>
          ) : (
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-3)", margin: "12px 2px 0" }}>
              Checking whether this basket is already managed&hellip;
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--neg)", marginTop: 10 }}>
              {error}
              {/* The auto-quote only re-fires when the AMOUNT changes, so a
                  failed quote used to strand the panel with Buy disabled until
                  the user edited the number. The error itself must be a retry. */}
              {valid && !busy && (
                <button
                  className="gvbp-press"
                  onClick={() => void getQuote(g.id, amountNum)}
                  style={{ display: "block", width: "100%", height: 38, marginTop: 8, borderRadius: 11, fontSize: 12.5, fontWeight: 700, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink)" }}
                >
                  Price it again
                </button>
              )}
            </div>
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
