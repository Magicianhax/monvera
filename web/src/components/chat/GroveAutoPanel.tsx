"use client";

// Auto-manage, the switch: consent lives on the grove page, never in chat.
//
// OFF -> the user picks a per-action budget and a cadence, sees all four hard
// caps spelled out, and signs ONE sponsored UserOp (standing approvals for the
// composition + enableAuto). ON -> the caps and usage read back from the
// contract, and one click revokes instantly — no cooldown, works while paused.
// SPENT -> the lifetime budget is a consent meter only the user can refill:
// renewal is its own explicit re-signature (enableAuto resets the spent
// counter, GroveManager.sol) — never auto-renewed, never pre-checked, never
// folded into another flow. The contract enforces every cap against the
// manager; this panel only writes the consent.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroveLive } from "@/hooks/useGroves";
import { useGroveAuto, useGroveAutoState } from "@/hooks/useGroveAuto";
import { defaultAutoPerActionUsd } from "@/lib/groveManager";
import { usd } from "./chatKit";
import { GroveModal, ModalWorking, ModalSuccessIcon, ReceiptRow, ModalButtons, ModalDoneButton, TrustCaption } from "./GroveModal";

const CADENCES = [
  { label: "Daily", seconds: 86_400 },
  { label: "Weekly", seconds: 604_800 },
  { label: "Monthly", seconds: 2_592_000 },
] as const;

/** Per-holding sell cap per rebalance — fixed, oracle-free blast radius. */
const FRACTION_BPS = 2_000;
/** Lifetime budget = this many per-action budgets. A year of monthlies. */
const LIFETIME_MULTIPLE = 12;

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" };

function cadenceLabel(seconds: number): string {
  const hit = CADENCES.find((c) => c.seconds === seconds);
  if (hit) return hit.label.toLowerCase();
  if (seconds % 86_400 === 0) return `every ${seconds / 86_400} days`;
  return `every ${Math.round(seconds / 3600)}h`;
}

export function GroveAutoPanel({ g, held, autoFocus, positionUsd }: { g: GroveLive; held: boolean; autoFocus?: boolean; positionUsd?: number }) {
  const open = g.onChainId !== undefined;
  const state = useGroveAutoState(open ? g.onChainId : undefined);
  const auto = useGroveAuto(g.onChainId, useMemo(() => g.components.map((c) => c.symbol), [g.components]));

  // The suggested per-action budget scales with the position — a flat number
  // was bigger than a small basket and useless for a large one. The user's
  // own edit always wins.
  const [perActionEdit, setPerActionEdit] = useState<number | null>(null);
  const perAction = perActionEdit ?? (positionUsd && positionUsd > 0 ? defaultAutoPerActionUsd(positionUsd) : 250);
  const [cadence, setCadence] = useState<number>(604_800);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Deep link (?auto=1 / "turn on auto-manage" in chat) lands the eye here.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [autoFocus]);

  const enabled = state.data?.enabled ?? false;
  const lifetime = perAction * LIFETIME_MULTIPLE;
  // $50 floor: at $50 the 0.98 cap haircut still clears our $15 minimum move
  // with real room; the old $20 left $4.60 of plannable headroom and the
  // feature felt dead. Ours — no venue imposes any minimum.
  const capOk = Number.isFinite(perAction) && perAction >= 50;

  // The consent meter, from the on-chain numbers. Exhaustion restates the
  // driver's skip condition VERBATIM (autoRebalance.ts: min(perAction,
  // remaining) × CAP_HAIRCUT 0.98 < $15 → "lifetime budget exhausted") so this
  // panel and the driver can never disagree about whether Vera can still act.
  // The $15 is OUR minimum move, never a venue's.
  const cfg = enabled ? state.data : undefined;
  const remainingUsd = cfg ? Math.max(0, cfg.maxTotalUsd - cfg.movedUsd) : 0;
  const exhausted = !!cfg && Math.min(cfg.maxPerActionUsd, remainingUsd) * 0.98 < 15;
  const lowWater = !!cfg && !exhausted && cfg.maxTotalUsd > 0 && remainingUsd / cfg.maxTotalUsd <= 0.25;

  const startEnable = () => {
    auto.reset();
    setConfirmOpen(true);
  };
  const confirmEnable = () => {
    void auto.enable({
      maxPerBuyUsdg: BigInt(Math.round(perAction * 1e6)),
      maxTotalUsdg: BigInt(Math.round(lifetime * 1e6)),
      minSecondsBetween: BigInt(cadence),
      maxRebalanceFractionBps: FRACTION_BPS,
    });
  };
  const startRenew = () => {
    auto.reset();
    setRenewOpen(true);
  };
  // Renewal re-signs enableAuto with the caps EXACTLY as they sit on-chain —
  // same consent, and the contract resets the spent counter to zero.
  const confirmRenew = () => {
    if (state.data) void auto.enable(state.data.caps);
  };
  const doRevoke = async () => {
    setRevoking(true);
    await auto.revoke();
    setRevoking(false);
  };

  return (
    <div ref={ref} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, padding: "15px 18px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={label}>Auto-manage</div>
        <span
          className="tnum"
          style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", color: enabled ? "var(--pos)" : "var(--ink-3)" }}
        >
          {enabled ? "on" : "off"}
        </span>
      </div>

      {!open ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--ink-3)" }}>
          Available once this grove opens on-chain.
        </p>
      ) : !held && !enabled ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--ink-3)" }}>
          Vera realigns a drifted basket back to the published weights — inside hard caps you set, every action a
          transaction in the Rebalances list. Buy this grove first; auto-manage works on an existing basket.
        </p>
      ) : enabled && state.data ? (
        <>
          <div style={{ marginTop: 4 }}>
            <ReceiptRow k="Per action, at most" v={usd(state.data.maxPerActionUsd)} />
            <ReceiptRow k="Lifetime budget" v={`${usd(state.data.movedUsd)} used of ${usd(state.data.maxTotalUsd)}`} />
            <ReceiptRow k="At most every" v={cadenceLabel(state.data.cooldownSeconds)} />
            <ReceiptRow k="Per holding, per rebalance" v={`${state.data.maxRebalanceFractionBps / 100}% max`} />
            <ReceiptRow
              k="Last action"
              v={state.data.lastActionAt ? new Date(state.data.lastActionAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "never yet"}
              muted
            />
          </div>
          {exhausted ? (
            <>
              <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>Budget spent — renew to continue.</span>{" "}
                Vera moved {usd(state.data.movedUsd)} under this consent and won&apos;t act again until you renew it.
              </div>
              <button
                onClick={startRenew}
                disabled={auto.busy}
                style={{ width: "100%", height: 42, marginTop: 10, borderRadius: 12, fontSize: 13.5, fontWeight: 700, background: "var(--panel-2)", border: "1px solid var(--line)", color: auto.busy ? "var(--ink-3)" : "var(--ink)", cursor: auto.busy ? "default" : "pointer" }}
              >
                Renew budget
              </button>
            </>
          ) : lowWater ? (
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 8 }}>
              Budget running down — {usd(remainingUsd)} of {usd(state.data.maxTotalUsd)} left.
            </div>
          ) : null}
          <button
            onClick={() => void doRevoke()}
            disabled={auto.busy}
            style={{ width: "100%", height: 40, marginTop: 10, borderRadius: 12, fontSize: 13, fontWeight: 600, border: "1px solid var(--line)", background: "transparent", color: auto.busy ? "var(--ink-3)" : "var(--ink)", cursor: auto.busy ? "default" : "pointer" }}
          >
            {revoking && auto.busy ? "Turning off…" : "Turn off auto-manage"}
          </button>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", textAlign: "center", marginTop: 6 }}>
            Instant — no cooldown, works even while the contract is paused.
          </div>
          {revoking && auto.error && (
            <div style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 8, lineHeight: 1.5 }}>{auto.error}</div>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: "8px 0 10px", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
            Every six hours Vera checks this basket against its published weights. She acts during US market
            hours on weekdays — the contract refuses stale oracle prices outside them — which today means one
            acting window per weekday; the other checks record drift and wait. She acts only on genuine drift,
            and only after reading the market first: a drift mid-storm waits rather than churns. Every action is
            a transaction in the Rebalances list, and every cap below is enforced by the contract, not by us.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", marginBottom: 4 }}>Per action, at most</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4, height: 38, padding: "0 10px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--panel-2)" }}>
                <span className="tnum" style={{ fontSize: 13, color: "var(--ink-3)" }}>$</span>
                <input
                  className="tnum"
                  type="number"
                  min={50}
                  value={perAction}
                  onChange={(e) => setPerActionEdit(Number(e.target.value))}
                  style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontWeight: 650, color: "var(--ink)" }}
                />
              </div>
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", marginBottom: 4 }}>At most</span>
              <select
                value={cadence}
                onChange={(e) => setCadence(Number(e.target.value))}
                style={{ width: "100%", height: 38, padding: "0 8px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
              >
                {CADENCES.map((c) => (
                  <option key={c.seconds} value={c.seconds}>{c.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.6, marginTop: 8 }}>
            Also fixed: at most {FRACTION_BPS / 100}% of any single holding per rebalance, and a lifetime budget of{" "}
            {capOk ? usd(lifetime) : "—"} ({LIFETIME_MULTIPLE}× per action). Turn it off any time, instantly.
          </div>
          <button
            onClick={startEnable}
            disabled={!capOk}
            style={{ width: "100%", height: 42, marginTop: 10, borderRadius: 12, fontSize: 13.5, fontWeight: 700, background: capOk ? "var(--panel-2)" : "var(--line)", border: "1px solid var(--line)", color: capOk ? "var(--ink)" : "var(--ink-3)", cursor: capOk ? "pointer" : "default" }}
          >
            Turn on auto-manage
          </button>
          {!capOk && <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6, textAlign: "center" }}>Below $50, most actions fall under our $15 minimum move.</div>}
        </>
      )}

      {confirmOpen && (
        <GroveModal title="Auto-manage" onClose={() => setConfirmOpen(false)} busy={auto.busy}>
          {auto.phase === "done" ? (
            <>
              <ModalSuccessIcon />
              <div style={{ textAlign: "center", fontSize: 14.5, fontWeight: 700, marginTop: 10 }}>Auto-manage is on</div>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)", textAlign: "center" }}>
                Vera acts only when the basket drifts, only inside your caps, and every action lands in the
                Rebalances list on this page.
              </p>
              <ModalDoneButton />
            </>
          ) : auto.busy ? (
            <ModalWorking title="Switching auto-manage on" step="One signature — consent and caps, recorded on-chain" />
          ) : (
            <>
              <p style={{ margin: "2px 0 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                You are consenting to manager rebalances of your {g.name} basket, inside these caps — each one
                enforced by the contract on every action:
              </p>
              <ReceiptRow k="Per action, at most" v={usd(perAction)} strong />
              <ReceiptRow k="At most" v={cadenceLabel(cadence)} />
              <ReceiptRow k="Per holding, per rebalance" v={`${FRACTION_BPS / 100}% max`} />
              <ReceiptRow k="Lifetime budget" v={usd(lifetime)} />
              <ReceiptRow k="Withdrawing consent" v="instant, any time" muted />
              {auto.error && <div style={{ fontSize: 11.5, color: "var(--neg)", margin: "8px 0 0", lineHeight: 1.5 }}>{auto.error}</div>}
              <TrustCaption>Only you can revoke — and selling always stays yours.</TrustCaption>
              <ModalButtons confirmLabel="Confirm and sign" onConfirm={confirmEnable} />
            </>
          )}
        </GroveModal>
      )}

      {/* Renewal is a deliberate re-signature and nothing else: it restates
          every cap and the spend before asking, and it never rides inside
          another flow. ("N actions" is not on-chain — only the moved total is,
          so only the total is stated.) */}
      {renewOpen && state.data && (
        <GroveModal title="Renew auto-manage" onClose={() => setRenewOpen(false)} busy={auto.busy}>
          {auto.phase === "done" ? (
            <>
              <ModalSuccessIcon />
              <div style={{ textAlign: "center", fontSize: 14.5, fontWeight: 700, marginTop: 10 }}>Budget renewed</div>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)", textAlign: "center" }}>
                Same caps, a fresh {usd(state.data.maxTotalUsd)} lifetime budget — the spent counter is back to
                zero, on-chain.
              </p>
              <ModalDoneButton />
            </>
          ) : auto.busy ? (
            <ModalWorking title="Renewing auto-manage" step="One signature — same caps, a fresh lifetime budget" />
          ) : (
            <>
              <p style={{ margin: "2px 0 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                Vera moved {usd(state.data.movedUsd)} under the old budget. Renewing signs the same consent
                again, with the same caps — and starts a fresh budget: the old one&apos;s spend resets to zero.
              </p>
              <ReceiptRow k="Per action, at most" v={usd(state.data.maxPerActionUsd)} strong />
              <ReceiptRow k="At most" v={cadenceLabel(state.data.cooldownSeconds)} />
              <ReceiptRow k="Per holding, per rebalance" v={`${state.data.maxRebalanceFractionBps / 100}% max`} />
              <ReceiptRow k="Fresh lifetime budget" v={usd(state.data.maxTotalUsd)} />
              <ReceiptRow k="Withdrawing consent" v="instant, any time" muted />
              {auto.error && <div style={{ fontSize: 11.5, color: "var(--neg)", margin: "8px 0 0", lineHeight: 1.5 }}>{auto.error}</div>}
              <TrustCaption>Only you can revoke — and selling always stays yours.</TrustCaption>
              <ModalButtons confirmLabel="Renew and sign" onConfirm={confirmRenew} />
            </>
          )}
        </GroveModal>
      )}
    </div>
  );
}
