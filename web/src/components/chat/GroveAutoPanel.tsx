"use client";

// The managed switch. A grove is a curated vault: depositing IS the consent
// to manage, so this card is a light switch, not a settings page. ON means
// Vera ACTIVELY manages the whole position until the user exits or flips it
// off: she sets each window's target weights herself, always within 0.7-1.3x
// of the published composition, and realigns to those.
//
// ⚠️ This card is the CONSENT surface, so its wording is the permission. It
// described "keeps this position at the published weights" until 2026-08-07 —
// written for the drift-only product and never updated through the pivot to
// active management, so it named a strictly narrower permission than the one
// Vera exercises. Any copy here must describe the band, not the composition.
// No budgets, no meters, no renewal chores: the
// contract's required cap fields are signed at values that never bind
// (MANAGED_AUTO_CAPS), and the protections that actually guard the money are
// cap-free anyway (Chainlink band per leg, venue whitelist, non-custody,
// instant revoke, guardian pause).
//
// Five states, HELD consulted first — a live config over an exited position
// must never pitch management of a basket that no longer exists:
//   1 grove not open          2 managed and held
//   3 managed but exited (the orphan a full exit leaves — exits never revoke)
//   4 held, not managed       5 neither
// Configs signed in the early narrow-caps era still bind on-chain and
// throttle Vera; state 2 alone offers the one "Upgrade" re-signature.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroveLive } from "@/hooks/useGroves";
import { useGroveAuto, useGroveAutoState } from "@/hooks/useGroveAuto";
import { MANAGED_AUTO_CAPS, isLegacyAutoConfig } from "@/lib/groveManager";
import { GroveModal, ModalWorking, ModalSuccessIcon, ReceiptRow, ModalButtons, ModalDoneButton, TrustCaption } from "./GroveModal";

const GVAP_CSS = `
.gvap-press{transition:transform .16s ease-out}
.gvap-press:active{transform:scale(.97)}
@keyframes gvapnote{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.gvap-note{animation:gvapnote .2s ease-out both}
@media (prefers-reduced-motion: reduce){
  .gvap-press{transition:none}
  .gvap-press:active{transform:none}
  .gvap-note{animation:none}
}
`;


export function GroveAutoPanel({ g, held, autoFocus }: { g: GroveLive; held: boolean; autoFocus?: boolean }) {
  const open = g.onChainId !== undefined;
  const state = useGroveAutoState(open ? g.onChainId : undefined);
  const auto = useGroveAuto(g.onChainId, useMemo(() => g.components.map((c) => c.symbol), [g.components]));

  const [confirmOpen, setConfirmOpen] = useState(false);
  // True from the moment Stop/Turn it off is pressed, until the next enable.
  // revoke() resolves without throwing even on failure, so the outcome is
  // read from the PHASE, never the promise: while set, phase "done" means the
  // revoke landed and auto.error is a revoke failure that must stay visible.
  const [revoking, setRevoking] = useState(false);
  // One-time confirmation after a successful revoke, shown instead of the
  // pitch — a fresh opt-out must not be re-pitched.
  const justRevoked = revoking && auto.phase === "done";

  // Deep link (?auto=1 / "manage my basket" in chat) lands the eye here.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [autoFocus]);

  const enabled = state.data?.enabled ?? false;
  const legacy = !!state.data && isLegacyAutoConfig(state.data);

  const startEnable = () => {
    setRevoking(false);
    auto.reset();
    setConfirmOpen(true);
  };
  const confirmEnable = () => {
    void auto.enable(MANAGED_AUTO_CAPS);
  };
  const doRevoke = () => {
    setRevoking(true);
    void auto.revoke();
  };

  const ghostBtn: React.CSSProperties = {
    width: "100%",
    height: 40,
    marginTop: 10,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    border: "1px solid var(--line)",
    background: "transparent",
    color: auto.busy ? "var(--ink-3)" : "var(--ink)",
    cursor: auto.busy ? "default" : "pointer",
  };
  const solidBtn: React.CSSProperties = {
    width: "100%",
    height: 42,
    marginTop: 10,
    borderRadius: 12,
    fontSize: 13.5,
    fontWeight: 700,
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    color: auto.busy ? "var(--ink-3)" : "var(--ink)",
    cursor: auto.busy ? "default" : "pointer",
  };
  const revokeError = revoking && auto.error && (
    <div style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 8, lineHeight: 1.5 }}>{auto.error}</div>
  );

  return (
    <div ref={ref} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, padding: "15px 18px 16px" }}>
      <style>{GVAP_CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Managed</div>
        <span
          style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", color: enabled ? "var(--pos)" : "var(--ink-3)", transition: "color .16s ease-out" }}
        >
          {enabled ? "On" : "Off"}
        </span>
      </div>

      {!open ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--ink-3)" }}>
          Available once this grove opens on-chain.
        </p>
      ) : enabled && state.data ? (
        held ? (
          <>
            <p style={{ margin: "8px 0 2px", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
              Vera holds one revocable permission: manage this position to targets she sets each window,
              always within 0.7–1.3× of its published weights. Every move is a public transaction in the
              Rebalances list.
            </p>
            <div style={{ marginTop: 4 }}>
              <ReceiptRow
                k="Last action"
                v={state.data.lastActionAt ? new Date(state.data.lastActionAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "never yet"}
                muted
              />
            </div>
            {legacy && (
              <>
                <div style={{ marginTop: 8, padding: "9px 12px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
                  This position still runs on an early, limited permission: Vera can only move part of it at a
                  time. One signature replaces the old limits with full management.
                </div>
                <button className="gvap-press" onClick={startEnable} disabled={auto.busy} style={{ ...solidBtn, marginTop: 8 }}>
                  Upgrade to full management
                </button>
              </>
            )}
            <button className="gvap-press" onClick={doRevoke} disabled={auto.busy} style={ghostBtn}>
              {revoking && auto.busy ? "Stopping…" : "Stop managing"}
            </button>
            <div style={{ fontSize: 10.5, color: "var(--ink-3)", textAlign: "center", marginTop: 6 }}>
              Instant. No cooldown, works even while the contract is paused.
            </div>
            {revokeError}
          </>
        ) : (
          <>
            <p style={{ margin: "8px 0 2px", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
              You have exited this grove, but the management permission from your old position is still
              switched on. It does nothing while you hold nothing. Turn it off now, or leave it for your next
              deposit.
            </p>
            <button className="gvap-press" onClick={doRevoke} disabled={auto.busy} style={ghostBtn}>
              {revoking && auto.busy ? "Stopping…" : "Turn it off"}
            </button>
            {revokeError}
          </>
        )
      ) : held ? (
        <>
          {justRevoked ? (
            <p className="gvap-note" style={{ margin: "8px 0 2px", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
              Management is off. Your basket stays exactly as you left it.
            </p>
          ) : (
            <p style={{ margin: "8px 0 2px", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
              Nothing manages this basket right now. It holds exactly what you bought until you say otherwise.
              One signature turns management on; stopping is always instant.
            </p>
          )}
          <button className="gvap-press" onClick={startEnable} disabled={auto.busy} style={solidBtn}>
            Manage my basket
          </button>
        </>
      ) : (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--ink-3)" }}>
          Every deposit here is managed: Vera sets each window&apos;s targets herself, within 0.7–1.3× of the
          published weights. Off at buy time, or any time after, instantly.
        </p>
      )}

      {confirmOpen && (
        <GroveModal title="Manage this basket" onClose={() => setConfirmOpen(false)} busy={auto.busy}>
          {auto.phase === "done" ? (
            <>
              <ModalSuccessIcon />
              <div style={{ textAlign: "center", fontSize: 14.5, fontWeight: 700, marginTop: 10 }}>Vera is managing it</div>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)", textAlign: "center" }}>
                Your whole {g.name} position is now managed to targets Vera sets each window, always within
                0.7–1.3× of its published weights. Every action lands in the Rebalances list, and you can stop
                any time, instantly.
              </p>
              <ModalDoneButton />
            </>
          ) : auto.busy ? (
            <ModalWorking title="Switching management on" step="One signature: your consent, recorded on-chain" />
          ) : (
            <>
              <p style={{ margin: "2px 0 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                You are authorizing Vera to actively manage your whole {g.name} basket. She sets each
                window&apos;s target weights herself — always within 0.7–1.3× of the published composition —
                and realigns to them. She cannot add a name, drop one, or move it to cash. The same way for
                everyone in the grove.
              </p>
              <ReceiptRow k="Every action" v="a public transaction" />
              <ReceiptRow k="Every price" v="checked against Chainlink on-chain" />
              <ReceiptRow k="Your funds" v="stay in your own account" />
              <ReceiptRow k="Stopping" v="instant, any time" strong />
              {auto.error && <div style={{ fontSize: 11.5, color: "var(--neg)", margin: "8px 0 0", lineHeight: 1.5 }}>{auto.error}</div>}
              <TrustCaption>Only you can stop it, and only you can withdraw.</TrustCaption>
              <ModalButtons confirmLabel="Confirm and sign" onConfirm={confirmEnable} />
            </>
          )}
        </GroveModal>
      )}
    </div>
  );
}
