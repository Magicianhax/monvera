"use client";

// Autopilot canvas — the chat app's MANUAL autopilot setup (ported from the
// classic AutopilotScreen). Same real rails: authorize Vera once (Privy session
// signer), save a bounded plan (amount · cadence · risk ceiling) to
// /api/autopilot, run it on demand, stop any time. Chat-glass styling.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionSigners, usePrivy } from "@privy-io/react-auth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance, useRefreshBalances } from "@/hooks/useBalances";
import { useToast } from "@/components/design";
import { authHeader } from "@/lib/authedFetch";
import { CADENCE_LABEL, type Cadence, type AutopilotConfig } from "@/lib/autopilot";
import { usd, txUrl, relTime } from "@/lib/format";
import { MIN_INVEST_USD } from "@/lib/arcusShared";
import { PIcon, panel, type ChatNav } from "./chatKit";
import { consumeAutopilotPrefill } from "./autopilotPrefill";

const PREFILL_RISK_INDEX = { careful: 0, balanced: 1, bolder: 2 } as const;

const CADENCES: Cadence[] = ["daily", "weekly", "biweekly", "monthly"];
const RISK_TIERS: { label: string; bps: number }[] = [
  { label: "Careful", bps: 4000 },
  { label: "Balanced", bps: 6000 },
  { label: "Bolder", bps: 8000 },
];
const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

type RunRow = {
  ranAt: number;
  amountUsd: number;
  status: "success" | "skipped" | "error";
  reason?: string;
  txHash?: string;
};

// Manual-run lifecycle. "Run now" signs and submits a REAL invest and can take
// ~a minute to come back, so the canvas narrates each phase out loud: the
// working beat replaces the status hero, and success/failure land as explicit
// cards. The old dimmed button + info toast read as "nothing is happening"
// while money moved.
type RunPhase =
  | { step: "idle" }
  | { step: "working"; amountUsd: number }
  | { step: "done"; amountUsd: number; txHash?: string }
  | { step: "failed"; reason: string };

// iOS-style solid chip on a translucent track (no glass-in-glass).
const chip = (on: boolean): React.CSSProperties => ({
  height: 32, padding: "0 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
  background: on ? "var(--bg)" : "transparent", boxShadow: on ? "0 1px 4px rgba(12,32,20,.14)" : "none",
  color: on ? "var(--primary)" : "var(--ink-3)",
});

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-2)", margin: "14px 0 7px" };

export function AutopilotCanvas({ nav }: { nav: ChatNav }) {
  const { user } = usePrivy();
  const { address: smartAccount } = useSmartAccount();
  const { data: bal } = useUsdcBalance(smartAccount ?? undefined);
  const cash = bal?.value ?? 0;
  const { addSessionSigners, removeSessionSigners } = useSessionSigners();
  const { notify } = useToast();

  // Delegation state lives on the LINKED ACCOUNT (not ConnectedWallet).
  type EmbeddedAcct = { type: "wallet"; address: string; walletClientType?: string; delegated?: boolean; id?: string | null };
  const embedded = user?.linkedAccounts?.find((a) => a.type === "wallet" && (a as EmbeddedAcct).walletClientType === "privy") as EmbeddedAcct | undefined;
  const ownerAddress = embedded?.address;
  const delegated = Boolean(embedded?.delegated);
  const walletId = embedded?.id ?? null;

  // Chat handoff: if Vera collected the plan details in conversation, they
  // arrive here as the form's initial values (a saved config still overrides).
  const [prefill] = useState(() => consumeAutopilotPrefill());
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("Grow my long-term plan");
  const [amount, setAmount] = useState(() => (prefill ? String(prefill.amountUsd) : "25"));
  const [cadence, setCadence] = useState<Cadence>(() => prefill?.cadence ?? "weekly");
  const [risk, setRisk] = useState<number>(() => (prefill ? PREFILL_RISK_INDEX[prefill.risk] : 1));
  const [runState, setRunState] = useState<RunPhase>({ step: "idle" });
  // A failed DELETE keeps the config on screen; this carries the message.
  const [stopError, setStopError] = useState<string | null>(null);

  const qc = useQueryClient();
  const refreshBalances = useRefreshBalances();

  // Config + run history follow the app's money-read policy (see useBalances):
  // calm poll + focus refetch, so a CRON run that fires while this canvas is
  // open shows up in the history without reopening it. The one-shot mount
  // fetch this replaced went stale the moment the schedule ran.
  const configQuery = useQuery({
    queryKey: ["autopilot-config", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AutopilotConfig | null> => {
      const res = await fetch("/api/autopilot", { headers: { ...(await authHeader()) } });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Couldn't load autopilot.");
      return (json?.autopilot as AutopilotConfig | null) ?? null;
    },
  });
  const config = configQuery.data ?? null;
  const loading = configQuery.isPending;

  const amountNum = Number(amount) || 0;
  const active = Boolean(config?.active);

  const runsQuery = useQuery({
    queryKey: ["autopilot-runs", user?.id],
    enabled: Boolean(user?.id) && active,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<RunRow[]> => {
      const r = await fetch("/api/autopilot/runs", { headers: { ...(await authHeader()) } });
      const j = await r.json();
      return Array.isArray(j?.runs) ? (j.runs as RunRow[]) : [];
    },
  });
  const runs = runsQuery.data ?? [];

  // Every mutation refreshes both reads immediately — the poll is only a
  // safety net, same contract as useRefreshBalances for the money queries.
  const refreshAutopilot = () => {
    void qc.invalidateQueries({ queryKey: ["autopilot-config"] });
    void qc.invalidateQueries({ queryKey: ["autopilot-runs"] });
  };

  // Seed the form from the saved config ONCE per open — the query now
  // refetches on a poll, and re-seeding every refetch would stomp whatever
  // the user is mid-editing below.
  const seeded = useRef(false);
  useEffect(() => {
    const ap = configQuery.data;
    if (seeded.current || !ap) return;
    seeded.current = true;
    setGoal(ap.goal);
    setAmount(String(ap.amountUsd));
    setCadence(ap.cadence);
    setRisk(Math.max(0, RISK_TIERS.findIndex((t) => t.bps === ap.riskCeilingBps)) || 1);
  }, [configQuery.data]);

  const authorize = async () => {
    if (!ownerAddress || busy) return;
    if (!PRIVY_SIGNER_ID) { notify("Signer not configured", "info"); return; }
    setBusy(true);
    try {
      await addSessionSigners({ address: ownerAddress, signers: [{ signerId: PRIVY_SIGNER_ID }] });
      notify("Vera is authorized", "check");
    } catch {
      notify("Authorization was declined", "info");
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (busy) return;
    if (!walletId || !ownerAddress || !smartAccount) { notify("Authorize Vera first", "info"); return; }
    if (amountNum < MIN_INVEST_USD) { notify(`Each run needs at least $${MIN_INVEST_USD}`, "info"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ walletId, owner: ownerAddress, smartAccount, goal, amountUsd: amountNum, cadence, riskCeilingBps: RISK_TIERS[risk].bps }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Couldn't save autopilot.");
      qc.setQueryData(["autopilot-config", user?.id], json.autopilot as AutopilotConfig);
      refreshAutopilot();
      notify("Autopilot is on", "check");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save autopilot.", "info");
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setStopError(null);
    try {
      // Only a CONFIRMED delete may say "off" — clearing local state on a
      // failed call once showed the green check while the cron kept spending.
      const res = await fetch("/api/autopilot", { method: "DELETE", headers: { ...(await authHeader()) } });
      if (!res.ok) throw new Error("delete failed");
      try { if (ownerAddress) await removeSessionSigners({ address: ownerAddress }); } catch { /* best-effort */ }
      qc.setQueryData(["autopilot-config", user?.id], null);
      refreshAutopilot();
      notify("Autopilot is off", "check");
    } catch {
      // Config stays on screen (query data untouched) so the badge keeps
      // telling the truth: it is still running.
      setStopError("Couldn't turn autopilot off — it is still running. Try again.");
    } finally { setBusy(false); }
  };

  const runNow = async () => {
    if (busy || runState.step === "working") return;
    // Capture the amount up front — the poll could swap the config mid-run.
    const amountUsd = config?.amountUsd ?? amountNum;
    setBusy(true);
    setRunState({ step: "working", amountUsd });
    try {
      const res = await fetch("/api/autopilot/run", { method: "POST", headers: { ...(await authHeader()) } });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        setRunState({ step: "failed", reason: json?.reason ?? json?.error ?? "The run didn't go through." });
      } else {
        setRunState({ step: "done", amountUsd, txHash: typeof json?.txHash === "string" ? json.txHash : undefined });
        notify("Vera invested for you", "check");
        // Money moved on-chain: pull fresh cash/portfolio/activity NOW, not at
        // the next 30s poll, and refresh the run log + spent-this-period.
        refreshBalances();
        refreshAutopilot();
      }
    } catch {
      setRunState({ step: "failed", reason: "The run didn't go through — check your connection and try again." });
    } finally { setBusy(false); }
  };

  return (
    <div>
      {/* status hero */}
      <div style={{ background: `linear-gradient(135deg,color-mix(in srgb,var(--primary) ${active ? 20 : 10}%,transparent),transparent 62%),var(--panel)`, border: "1px solid var(--line)", borderRadius: 22, padding: 20 }}>
        {runState.step === "working" ? (
          /* in-flight beat (GroveModal's plain-spinner language): the hero
             disappears while real money is being signed and placed, because a
             frozen card with a dimmed button reads as "nothing is happening" */
          <div role="status" aria-live="polite" style={{ textAlign: "center", padding: "14px 0 10px" }}>
            <span aria-hidden style={{ display: "inline-block", width: 42, height: 42, borderRadius: "50%", border: "3px solid var(--line)", borderTopColor: "var(--primary)", animation: "mvcspin .8s linear infinite" }} />
            <div className="serif" style={{ fontSize: 20, fontWeight: 500, marginTop: 12 }}>Vera is investing {usd(runState.amountUsd)}…</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4 }}>Signing and placing it on-chain — usually under a minute. Keep this open.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, background: active ? "var(--primary-soft)" : "var(--panel-2)", color: active ? "var(--primary)" : "var(--ink-3)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />{active ? "Running" : "Standby"}
              </span>
              {active && (
                <button onClick={() => void runNow()} disabled={busy} style={{ height: 32, padding: "0 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", opacity: busy ? 0.6 : 1 }}>Run now</button>
              )}
            </div>
            <div className="serif" style={{ fontSize: 23, fontWeight: 500, marginTop: 10, letterSpacing: "-.01em" }}>
              {active ? `${usd(config?.amountUsd ?? 0)} · ${CADENCE_LABEL[config?.cadence ?? "weekly"]}` : "Invest on repeat"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>
              {active
                ? `Vera builds a fresh ${RISK_TIERS.find((t) => t.bps === config?.riskCeilingBps)?.label.toLowerCase() ?? "balanced"} plan each run — never more than you authorized.`
                : "A set amount on a schedule. Vera re-allocates every run, signs it on-chain, and places it gasless — within hard limits you set."}
            </div>
          </>
        )}
      </div>

      {/* run result — an explicit beat in the canvas, not a toast that slides
          away while the balances still look unchanged */}
      {runState.step === "done" && (
        <div style={{ marginTop: 12, padding: "14px 16px", borderRadius: 16, border: "1px solid color-mix(in srgb,var(--pos) 40%,var(--line))", background: "color-mix(in srgb,var(--pos) 9%,var(--panel))", display: "flex", alignItems: "center", gap: 12 }}>
          <style>{`@keyframes appop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}@media (prefers-reduced-motion: reduce){.appop{animation:none!important}}`}</style>
          <span className="appop" style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: "color-mix(in srgb,var(--pos) 18%,transparent)", color: "var(--pos)", animation: "appop .5s cubic-bezier(.34,1.56,.64,1) both" }}>
            <PIcon name="ph-check-circle" size={24} weight="fill" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Vera invested {usd(runState.amountUsd)}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
              {runState.txHash ? (
                <a href={txUrl(runState.txHash)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
                  View the transaction <PIcon name="ph-arrow-square-out" size={11} style={{ display: "inline-block" }} />
                </a>
              ) : "Placed on-chain — it will show in your activity in a moment."}
            </div>
          </div>
          <button onClick={() => setRunState({ step: "idle" })} aria-label="Dismiss" style={{ width: 28, height: 28, borderRadius: 999, flex: "none", display: "grid", placeItems: "center", background: "transparent", color: "var(--ink-3)" }}>
            <PIcon name="ph-x" size={14} />
          </button>
        </div>
      )}
      {runState.step === "failed" && (
        <div role="alert" style={{ marginTop: 12, padding: "14px 16px", borderRadius: 16, border: "1px solid color-mix(in srgb,var(--neg) 40%,var(--line))", background: "color-mix(in srgb,var(--neg) 8%,var(--panel))", display: "flex", alignItems: "center", gap: 12 }}>
          <PIcon name="ph-warning-circle" size={22} weight="fill" style={{ color: "var(--neg)", flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--neg)" }}>The run didn&apos;t go through</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.45 }}>{runState.reason}</div>
          </div>
          <button onClick={() => void runNow()} disabled={busy} style={{ height: 32, padding: "0 14px", borderRadius: 999, flex: "none", fontSize: 12.5, fontWeight: 700, border: "1px solid color-mix(in srgb,var(--neg) 35%,var(--line))", background: "transparent", color: "var(--neg)", opacity: busy ? 0.6 : 1 }}>Retry</button>
        </div>
      )}

      {/* step 1 — authorize */}
      {!delegated && (
        <div style={panel({ marginTop: 12, padding: 16, display: "flex", alignItems: "center", gap: 12 })}>
          <span style={{ width: 38, height: 38, borderRadius: 12, flex: "none", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}><PIcon name="ph-signature" size={19} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Authorize Vera once</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Revocable any time — she can only act within your limits</div>
          </div>
          <button onClick={() => void authorize()} disabled={busy || !ownerAddress} style={{ height: 38, padding: "0 15px", borderRadius: 12, fontSize: 13, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", opacity: busy || !ownerAddress ? 0.6 : 1, flex: "none" }}>
            {busy ? "…" : "Authorize"}
          </button>
        </div>
      )}

      {/* quick starts — the old app's four one-tap templates, shown until a
          plan is saved; a tap fills the whole form below */}
      {!config && !loading && (
        <div style={{ marginTop: 4, padding: "0 4px" }}>
          <div style={label}>Quick starts</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {([
              { name: "Steady saver", goal: "Grow my long-term plan", amount: "25", cadence: "weekly" as Cadence, risk: 1, icon: "ph-shield-check" },
              { name: "Play it safe", goal: "Safe, steady growth", amount: "20", cadence: "weekly" as Cadence, risk: 0, icon: "ph-lock-simple" },
              { name: "Big tech DCA", goal: "Weekly into big tech names", amount: "50", cadence: "weekly" as Cadence, risk: 2, icon: "ph-trend-up" },
              { name: "Daily dollars", goal: "A little into the market each day", amount: "11", cadence: "daily" as Cadence, risk: 1, icon: "ph-clock" },
            ]).map((t) => {
              const on = goal === t.goal && amount === t.amount && cadence === t.cadence && risk === t.risk;
              return (
                <button key={t.name} onClick={() => { setGoal(t.goal); setAmount(t.amount); setCadence(t.cadence); setRisk(t.risk); }} style={{ textAlign: "left", padding: "11px 12px", borderRadius: 14, border: `1.5px solid ${on ? "var(--primary)" : "var(--line)"}`, background: on ? "var(--primary-soft)" : "var(--panel)", transition: "border-color .18s, background .18s" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                    <PIcon name={t.icon} size={15} weight="fill" style={{ color: "var(--primary)" }} /> {t.name}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>${t.amount} {t.cadence}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* the plan — naked form on the rail */}
      <div style={{ marginTop: 4, padding: "0 4px" }}>
        <div style={label}>Goal</div>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What's this money for?" style={{ width: "100%", height: 42, borderRadius: 13, border: "1px solid var(--line)", background: "var(--panel-2)", outline: "none", color: "var(--ink)", padding: "0 13px", fontSize: 13.5, fontFamily: "inherit" }} />

        <div style={label}>Amount per run</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 13, padding: "8px 13px" }}>
          <span className="tnum" style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-3)" }}>$</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Amount per run in dollars" className="tnum" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 17, fontWeight: 600, minWidth: 0 }} />
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{usd(cash)} cash</span>
        </div>
        {amountNum > 0 && amountNum < MIN_INVEST_USD && <div style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 5 }}>Each run needs at least ${MIN_INVEST_USD}.</div>}

        <div style={label}>How often</div>
        <div className="nosb" style={{ display: "inline-flex", background: "var(--panel-2)", borderRadius: 999, padding: 3, gap: 2, maxWidth: "100%", overflowX: "auto", scrollbarWidth: "none" }}>
          {CADENCES.map((c) => <button key={c} onClick={() => setCadence(c)} style={chip(c === cadence)}>{CADENCE_LABEL[c]}</button>)}
        </div>

        <div style={label}>Risk ceiling</div>
        <div style={{ display: "inline-flex", background: "var(--panel-2)", borderRadius: 999, padding: 3, gap: 2 }}>
          {RISK_TIERS.map((t, i) => <button key={t.label} onClick={() => setRisk(i)} style={chip(i === risk)}>{t.label}</button>)}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={() => void save()} disabled={busy || loading} style={{ flex: 1, height: 48, borderRadius: 14, fontSize: 14.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", opacity: busy || loading ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <PIcon name="ph-sliders-horizontal" size={16} /> {active ? "Update plan" : "Start Autopilot"}
          </button>
          {active && (
            <button onClick={() => void stop()} disabled={busy} style={{ height: 48, padding: "0 16px", borderRadius: 14, fontSize: 13.5, fontWeight: 600, border: "1px solid color-mix(in srgb,var(--neg) 35%,var(--line))", background: "transparent", color: "var(--neg)" }}>Stop</button>
          )}
        </div>
        {/* a failed stop must NOT pretend it worked — the cron would keep
            spending behind a green check */}
        {stopError && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: "11px 13px", borderRadius: 13, border: "1px solid color-mix(in srgb,var(--neg) 40%,var(--line))", background: "color-mix(in srgb,var(--neg) 8%,var(--panel-2))" }}>
            <PIcon name="ph-warning-circle" size={18} weight="fill" style={{ color: "var(--neg)", flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}>{stopError}</span>
            <button onClick={() => void stop()} disabled={busy} style={{ height: 30, padding: "0 13px", borderRadius: 999, flex: "none", fontSize: 12, fontWeight: 700, border: "1px solid color-mix(in srgb,var(--neg) 35%,var(--line))", background: "transparent", color: "var(--neg)", opacity: busy ? 0.6 : 1 }}>Retry</button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)", marginTop: 9 }}>
          <PIcon name="ph-lock-key" size={13} weight="fill" style={{ color: "var(--primary)" }} /> Bounded · revocable · every run signed on-chain
        </div>

        {/* prefer chat? */}
        <button onClick={() => nav.askVera("Set up Autopilot for me — ask me about amount, how often, and how bold to be")} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 7, height: 40, marginTop: 10, borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--ink-2)", fontSize: 12.5, fontWeight: 600 }}>
          <PIcon name="ph-sparkle" size={14} weight="fill" style={{ color: "var(--primary)" }} /> Or let Vera set it up with you in chat
        </button>
      </div>

      {/* run history */}
      {active && runs.length > 0 && (
        <div style={{ marginTop: 16, padding: "0 4px" }}>
          <div style={{ padding: "0 0 6px", fontSize: 13.5, fontWeight: 700 }}>Recent runs</div>
          {runs.slice(0, 5).map((r, i) => (
            <div key={`${r.ranAt}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
              <PIcon name={r.status === "success" ? "ph-check-circle" : r.status === "skipped" ? "ph-minus" : "ph-x"} size={17} weight="fill" style={{ color: r.status === "success" ? "var(--pos)" : r.status === "error" ? "var(--neg)" : "var(--ink-3)" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                {r.status === "success" ? `Invested ${usd(r.amountUsd)}` : r.status === "skipped" ? (r.reason ?? "Skipped") : (r.reason ?? "Didn't go through")}
              </span>
              {r.txHash && (
                <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--ink-3)", textDecoration: "none" }}>
                  {relTime(r.ranAt)} <PIcon name="ph-arrow-square-out" size={11} />
                </a>
              )}
              {!r.txHash && <span className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{relTime(r.ranAt)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
