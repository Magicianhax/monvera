"use client";

// Autopilot canvas — the chat app's MANUAL autopilot setup (ported from the
// classic AutopilotScreen). Same real rails: authorize Vera once (Privy session
// signer), save a bounded plan (amount · cadence · risk ceiling) to
// /api/autopilot, run it on demand, stop any time. Chat-glass styling.
import { useCallback, useEffect, useState } from "react";
import { useSessionSigners, usePrivy } from "@privy-io/react-auth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance } from "@/hooks/useBalances";
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
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("Grow my long-term plan");
  const [amount, setAmount] = useState(() => (prefill ? String(prefill.amountUsd) : "25"));
  const [cadence, setCadence] = useState<Cadence>(() => prefill?.cadence ?? "weekly");
  const [risk, setRisk] = useState<number>(() => (prefill ? PREFILL_RISK_INDEX[prefill.risk] : 1));
  const [runs, setRuns] = useState<RunRow[]>([]);

  const amountNum = Number(amount) || 0;
  const active = Boolean(config?.active);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/autopilot", { headers: { ...(await authHeader()) } });
        const json = await res.json();
        if (cancelled) return;
        const ap = json?.autopilot as AutopilotConfig | null;
        if (ap) {
          setConfig(ap);
          setGoal(ap.goal);
          setAmount(String(ap.amountUsd));
          setCadence(ap.cadence);
          setRisk(Math.max(0, RISK_TIERS.findIndex((t) => t.bps === ap.riskCeilingBps)) || 1);
        }
      } catch { /* defaults stand */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch("/api/autopilot/runs", { headers: { ...(await authHeader()) } });
      const j = await r.json();
      if (Array.isArray(j?.runs)) setRuns(j.runs as RunRow[]);
    } catch { /* best-effort */ }
  }, []);
  useEffect(() => { if (active) void loadRuns(); }, [active, loadRuns]);

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
      setConfig(json.autopilot as AutopilotConfig);
      notify("Autopilot is on", "check");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save autopilot.", "info");
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/autopilot", { method: "DELETE", headers: { ...(await authHeader()) } });
      try { if (ownerAddress) await removeSessionSigners({ address: ownerAddress }); } catch { /* best-effort */ }
      setConfig(null);
      notify("Autopilot is off", "check");
    } finally { setBusy(false); }
  };

  const runNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/autopilot/run", { method: "POST", headers: { ...(await authHeader()) } });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        notify(json?.reason ?? json?.error ?? "The run didn't go through.", "info");
      } else {
        notify("Vera invested for you", "check");
        void loadRuns();
      }
    } catch {
      notify("The run didn't go through.", "info");
    } finally { setBusy(false); }
  };

  return (
    <div>
      {/* status hero */}
      <div style={{ background: `linear-gradient(135deg,color-mix(in srgb,var(--primary) ${active ? 20 : 10}%,transparent),transparent 62%),var(--panel)`, border: "1px solid var(--line)", borderRadius: 22, padding: 20 }}>
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
      </div>

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
