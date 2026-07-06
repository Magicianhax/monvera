"use client";

// Autopilot — Vera invests for you on a schedule, autonomously, within bounds you
// authorize. You delegate your embedded wallet once (Privy session signer), set a
// recurring plan (amount · cadence · risk ceiling), and a server job runs it. The
// delegation is revocable any time, and every run is gated by hard limits.
import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { useSessionSigners, usePrivy } from "@privy-io/react-auth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance } from "@/hooks/useBalances";
import { useToast, Icon, Seal, BottomSheet, type IconName } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { displayFor } from "@/lib/displayAssets";
import { authHeader } from "@/lib/authedFetch";
import { CADENCE_LABEL, type Cadence, type AutopilotConfig } from "@/lib/autopilot";
import { usd, txUrl } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { iconBtn, Spinner, LogoStack } from "./primitives";

const CADENCES: Cadence[] = ["daily", "weekly", "biweekly", "monthly"];
const RISK_TIERS: { label: string; bps: number }[] = [
  { label: "Careful", bps: 4000 },
  { label: "Balanced", bps: 6000 },
  { label: "Bolder", bps: 8000 },
];

// The server's key-quorum / signer id (Privy dashboard → Wallet API signers).
// Granting it as a session signer lets the backend sign for the user's TEE wallet.
const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

// Quick-start presets — tap one to fill the plan below. risk = index into RISK_TIERS.
const TEMPLATES: { name: string; goal: string; amount: string; cadence: Cadence; risk: number; icon: IconName }[] = [
  { name: "Steady saver", goal: "Grow my long-term plan", amount: "25", cadence: "weekly", risk: 1, icon: "shieldPlain" },
  { name: "Play it safe", goal: "Safe, steady growth", amount: "20", cadence: "weekly", risk: 0, icon: "lock" },
  { name: "Big tech DCA", goal: "Weekly into big tech names", amount: "50", cadence: "weekly", risk: 2, icon: "trend" },
  { name: "Daily dollars", goal: "A little into the market each day", amount: "5", cadence: "daily", risk: 1, icon: "clock" },
];

// Shared glass stat tile (plan summary) — replaces hairline dividers so the
// numbers sit in soft frosted cells that match the rounded theme.
const planTile: CSSProperties = { flex: 1, background: "var(--glass-bg-2)", borderRadius: "var(--r)", padding: "12px 6px", textAlign: "center" };
const tileLabel: CSSProperties = { fontSize: 11.5, fontWeight: 500, color: "var(--ink-2)", marginTop: 4 };
// Soft rounded input surface for the plan form (goal / amount).
const softInput: CSSProperties = { borderRadius: "var(--r)", border: "none", background: "var(--surface-2)", outline: "none", color: "var(--ink)" };

type RunRow = {
  ranAt: number;
  amountUsd: number;
  assessedRiskBps?: number;
  status: "success" | "skipped" | "error";
  reason?: string;
  txHash?: string;
  holdings?: { symbol: string; weightPct: number; amountUsd: number }[];
};

export function AutopilotScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { user } = usePrivy();
  const { address: smartAccount } = useSmartAccount();
  const { data: bal } = useUsdcBalance(smartAccount ?? undefined);
  const cash = bal?.value ?? 0;
  const { addSessionSigners, removeSessionSigners } = useSessionSigners();
  const { notify } = useToast();

  // The embedded wallet linked account carries the `delegated` flag + the server
  // `id` (walletId) that the backend signs with. (ConnectedWallet from useWallets
  // does NOT — those fields live on the linked account.)
  type EmbeddedAcct = { type: "wallet"; address: string; walletClientType?: string; delegated?: boolean; id?: string | null };
  const embedded = user?.linkedAccounts?.find(
    (a) => a.type === "wallet" && (a as EmbeddedAcct).walletClientType === "privy",
  ) as EmbeddedAcct | undefined;
  const ownerAddress = embedded?.address;
  const delegated = Boolean(embedded?.delegated);
  const walletId = embedded?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state.
  const [goal, setGoal] = useState("Grow my long-term plan");
  const [amount, setAmount] = useState("25");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [risk, setRisk] = useState(1); // index into RISK_TIERS
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [detailRun, setDetailRun] = useState<RunRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Activity view: collapsed shows the latest 5; "View all" pages 10 at a time.
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [runsPage, setRunsPage] = useState(0);

  // Load the current autopilot (if any).
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
      } catch {
        /* leave defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const amountNum = Number(amount) || 0;
  const active = Boolean(config?.active);

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setGoal(t.goal);
    setAmount(t.amount);
    setCadence(t.cadence);
    setRisk(t.risk);
    setActiveTemplate(t.name);
    haptic.light();
  };

  // Load Vera's run history (audit trail) when an autopilot is active.
  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch("/api/autopilot/runs", { headers: { ...(await authHeader()) } });
      const j = await r.json();
      if (Array.isArray(j?.runs)) setRuns(j.runs as RunRow[]);
    } catch {
      /* activity is best-effort */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/autopilot/runs", { headers: { ...(await authHeader()) } });
        const j = await r.json();
        if (!cancelled && Array.isArray(j?.runs)) setRuns(j.runs as RunRow[]);
      } catch {
        /* activity is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const authorize = async () => {
    if (!ownerAddress) return;
    if (!PRIVY_SIGNER_ID) {
      notify("Signer not configured (NEXT_PUBLIC_PRIVY_SIGNER_ID)", "info");
      return;
    }
    setBusy(true);
    try {
      // TEE wallets: grant the server's signer as a session signer (not on-device
      // delegation). The backend then signs UserOps for this wallet.
      await addSessionSigners({ address: ownerAddress, signers: [{ signerId: PRIVY_SIGNER_ID }] });
      haptic.success();
      notify("Vera is authorized", "check");
    } catch {
      notify("Authorization was declined", "info");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!walletId || !ownerAddress || !smartAccount) {
      notify("Authorize Vera first", "info");
      return;
    }
    if (amountNum <= 0) {
      notify("Set an amount", "info");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          walletId,
          owner: ownerAddress,
          smartAccount,
          goal,
          amountUsd: amountNum,
          cadence,
          riskCeilingBps: RISK_TIERS[risk].bps,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Couldn't save autopilot.");
      setConfig(json.autopilot as AutopilotConfig);
      haptic.success();
      notify("Autopilot is on", "check");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save autopilot.", "info");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await fetch("/api/autopilot", { method: "DELETE", headers: { ...(await authHeader()) } });
      try {
        if (ownerAddress) await removeSessionSigners({ address: ownerAddress });
      } catch {
        /* revoking the session signer is best-effort */
      }
      setConfig(null);
      haptic.medium();
      notify("Autopilot is off", "check");
    } finally {
      setBusy(false);
    }
  };

  // Trigger one autonomous run immediately (Vera re-allocates, signs, and places
  // it server-side — no user signature). Same bounds gate as the scheduled cron.
  const runNow = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/autopilot/run", { method: "POST", headers: { ...(await authHeader()) } });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        notify(json?.reason ?? json?.error ?? "The run didn't go through.", "info");
      } else {
        haptic.success();
        notify("Vera invested for you", "check");
        try {
          const r = await fetch("/api/autopilot", { headers: { ...(await authHeader()) } });
          const j = await r.json();
          if (j?.autopilot) setConfig(j.autopilot as AutopilotConfig);
        } catch {
          /* status refresh is best-effort */
        }
        void loadRuns();
      }
    } catch {
      notify("The run didn't go through.", "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Autopilot</h1>
      </div>

      <div className="anim-rise" style={{ padding: "8px 22px 0" }}>
        <p style={{ margin: 0, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
          Let Vera invest for you on a schedule, automatically and gasless, within limits you set.
          She can never spend more, or take more risk, than you authorize.
        </p>
      </div>

      {loading ? (
        <div style={{ padding: "40px", display: "grid", placeItems: "center" }}><Spinner /></div>
      ) : (
        <>
          {/* ACTIVE: status + plan summary + run history (the dashboard) */}
          {active && config && (
            <>
              <div className="anim-rise" style={{ padding: "16px 22px 0" }}>
                <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                  <Seal size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>On · {usd(config.amountUsd)} {CADENCE_LABEL[config.cadence].toLowerCase()}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                      Next run {new Date(config.nextRunAt * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {config.runs} run{config.runs === 1 ? "" : "s"} so far
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: "20px 22px 0" }}>
                <div className="label-eyebrow" style={{ marginBottom: 8, textAlign: "center" }}>Your plan</div>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontWeight: 600, fontSize: 16.5, textAlign: "center", letterSpacing: "-.01em" }}>{config.goal}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <div style={planTile}>
                      <div className="tnum" style={{ fontWeight: 600, fontSize: 17 }}>{usd(config.amountUsd)}</div>
                      <div style={tileLabel}>Each run</div>
                    </div>
                    <div style={planTile}>
                      <div style={{ fontWeight: 600, fontSize: 17, textTransform: "capitalize" }}>{CADENCE_LABEL[config.cadence].replace("Every ", "").trim()}</div>
                      <div style={tileLabel}>Cadence</div>
                    </div>
                    <div style={planTile}>
                      <div className="tnum" style={{ fontWeight: 600, fontSize: 17 }}>≤{Math.round(config.riskCeilingBps / 100)}%</div>
                      <div style={tileLabel}>Risk</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", marginTop: 16, paddingTop: 13, borderTop: "1px solid var(--line-2)", fontSize: 13, fontWeight: 500, color: cash + 1e-6 >= config.amountUsd ? "var(--ink-2)" : "var(--neg)" }}>
                    {usd(cash)} available{cash + 1e-6 < config.amountUsd ? " · add cash to keep running" : ""}
                  </div>
                </div>
              </div>

              <div style={{ padding: "20px 22px 0" }}>
                <div className="label-eyebrow" style={{ marginBottom: 8, textAlign: "center" }}>Activity</div>
                {runs.length === 0 ? (
                  <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.5 }}>
                    No runs yet. Vera&apos;s actions will appear here, each one tappable.
                  </div>
                ) : (() => {
                  const PAGE = 10;
                  const pageCount = Math.max(1, Math.ceil(runs.length / PAGE));
                  const page = Math.min(runsPage, pageCount - 1);
                  const visible = runsExpanded
                    ? runs.slice(page * PAGE, page * PAGE + PAGE)
                    : runs.slice(0, 5);
                  return (
                  <>
                  <div className="card" style={{ padding: "4px 16px" }}>
                    {visible.map((r, i) => {
                      const okRun = r.status === "success";
                      const skipped = r.status === "skipped";
                      const when = new Date(r.ranAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                      const bought = (r.holdings ?? []).map((h) => displayFor(h.symbol).name);
                      const syms = (r.holdings ?? []).map((h) => h.symbol);
                      const sub = okRun
                        ? bought.length
                          ? `${bought.slice(0, 2).join(", ")}${bought.length > 2 ? ` +${bought.length - 2}` : ""}`
                          : `${Math.round((r.assessedRiskBps ?? 0) / 100)}% risk`
                        : (r.reason ?? "");
                      return (
                        <button
                          key={`${r.ranAt}-${i}`}
                          onClick={() => setDetailRun(r)}
                          className="row tap"
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", textAlign: "left", borderBottom: i < visible.length - 1 ? "1px solid var(--line-2)" : "none" }}
                        >
                          {okRun && syms.length > 0 ? (
                            <LogoStack symbols={syms} size={30} max={3} ring="var(--surface)" />
                          ) : (
                            <span
                              style={{ width: 34, height: 34, borderRadius: "var(--r-sm)", flex: "none", display: "grid", placeItems: "center", background: okRun ? "var(--primary-soft)" : skipped ? "var(--surface-2)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: okRun ? "var(--primary)" : skipped ? "var(--ink-3)" : "var(--neg)" }}
                            >
                              <Icon name={okRun ? "check" : skipped ? "clock" : "info"} size={17} stroke={okRun ? 2.4 : undefined} />
                            </span>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: 14 }}>
                              {okRun ? `Invested ${usd(r.amountUsd)}` : skipped ? "Skipped this run" : "Run didn't go through"}
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {when}
                              {sub ? ` · ${sub}` : ""}
                            </div>
                          </div>
                          <Icon name="chevR" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />
                        </button>
                      );
                    })}
                  </div>

                  {/* Collapsed: a single "View all" when there's more than 5.
                      Expanded: a 10-per-page pager plus a way back to collapsed. */}
                  {!runsExpanded && runs.length > 5 && (
                    <button
                      className="tap"
                      onClick={() => { setRunsExpanded(true); setRunsPage(0); }}
                      style={{ width: "100%", marginTop: 10, padding: "11px 0", textAlign: "center", background: "var(--surface-2)", borderRadius: "var(--r)", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                    >
                      View all {runs.length} runs
                    </button>
                  )}
                  {runsExpanded && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
                      <button
                        className="tap"
                        onClick={() => { setRunsExpanded(false); setRunsPage(0); }}
                        style={{ padding: "8px 12px", background: "none", fontSize: 12.5, fontWeight: 500, color: "var(--ink-3)" }}
                      >
                        Show less
                      </button>
                      {pageCount > 1 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            className="tap"
                            disabled={page === 0}
                            onClick={() => setRunsPage((p) => Math.max(0, p - 1))}
                            style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 99, background: "var(--surface-2)", color: "var(--ink)", opacity: page === 0 ? 0.4 : 1 }}
                            aria-label="Previous page"
                          >
                            <Icon name="chevL" size={16} />
                          </button>
                          <span className="tnum" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)", minWidth: 54, textAlign: "center" }}>
                            {page + 1} of {pageCount}
                          </span>
                          <button
                            className="tap"
                            disabled={page >= pageCount - 1}
                            onClick={() => setRunsPage((p) => Math.min(pageCount - 1, p + 1))}
                            style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 99, background: "var(--surface-2)", color: "var(--ink)", opacity: page >= pageCount - 1 ? 0.4 : 1 }}
                            aria-label="Next page"
                          >
                            <Icon name="chevR" size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  </>
                  );
                })()}
              </div>
            </>
          )}

          {/* SETUP: authorize + template + plan + start (only when not running) */}
          {!active && (
          <>
          <div style={{ padding: "18px 22px 0" }}>
            <div className="label-eyebrow" style={{ marginBottom: 8 }}>Authorization</div>
            <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <Icon name={delegated ? "shield" : "lock"} size={20} style={{ color: delegated ? "var(--primary)" : "var(--ink-3)", flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14.5 }}>{delegated ? "Vera is authorized" : "Authorize Vera"}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
                  {delegated ? "Bounded, gasless, revocable any time." : "A one-time grant so Vera can place your scheduled plans."}
                </div>
              </div>
              {!delegated && (
                <button className="btn btn-primary tap" disabled={busy} onClick={authorize} style={{ height: 38, padding: "0 14px", flex: "none" }}>
                  {busy ? <Spinner small /> : "Authorize"}
                </button>
              )}
            </div>
          </div>

          {/* quick-start templates — tap to fill the plan below */}
          <div style={{ padding: "20px 22px 0" }}>
            <div className="label-eyebrow" style={{ marginBottom: 8, textAlign: "center" }}>Start from a template</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {TEMPLATES.map((t) => {
                const on = activeTemplate === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => applyTemplate(t)}
                    className="card tap"
                    style={{ textAlign: "left", padding: "14px", display: "flex", flexDirection: "column", gap: 10, ...(on ? { boxShadow: "var(--glass-shadow), var(--glass-hi), inset 0 0 0 1.5px var(--primary)" } : {}) }}
                  >
                    <span
                      style={{ width: 34, height: 34, borderRadius: "var(--r-sm)", display: "grid", placeItems: "center", background: on ? "var(--primary)" : "var(--primary-soft)", color: on ? "var(--primary-ink)" : "var(--primary)" }}
                    >
                      <Icon name={t.icon} size={19} />
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.35 }}>
                        {usd(Number(t.amount))} · {CADENCE_LABEL[t.cadence].replace("Every ", "")} · {RISK_TIERS[t.risk].label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* config form */}
          <div style={{ padding: "20px 22px 0" }}>
            <div className="label-eyebrow" style={{ marginBottom: 8 }}>Your plan</div>
            <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Goal</span>
                <input
                  value={goal}
                  onChange={(e) => { setGoal(e.target.value); setActiveTemplate(null); }}
                  maxLength={120}
                  style={{ width: "100%", marginTop: 6, padding: "12px 14px", fontSize: 14.5, ...softInput }}
                />
              </label>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Amount each run</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: cash + 1e-6 >= amountNum ? "var(--ink-3)" : "var(--neg)" }}>
                    {usd(cash)} available
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "10px 14px", ...softInput }}>
                  <span className="tnum" style={{ fontSize: 20, fontWeight: 600 }}>$</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setActiveTemplate(null); }}
                    className="tnum"
                    style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 20, fontWeight: 600, color: "var(--ink)" }}
                  />
                </div>
              </div>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>How often</span>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {CADENCES.map((c) => (
                    <button key={c} onClick={() => { setCadence(c); setActiveTemplate(null); }} className={`chip tap ${cadence === c ? "is-dark" : ""}`} style={{ height: 36, flex: "1 1 auto" }}>
                      {CADENCE_LABEL[c].replace("Every ", "")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Risk ceiling Vera won&apos;t cross</span>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {RISK_TIERS.map((t, i) => (
                    <button key={t.label} onClick={() => { setRisk(i); setActiveTemplate(null); }} className={`chip tap ${risk === i ? "is-dark" : ""}`} style={{ height: 36, flex: 1, justifyContent: "center" }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
              Each run deploys {usd(amountNum)} (gas on us, price includes the quoted spread) only if your balance covers it and Vera&apos;s
              risk stays at or under your ceiling. Capped at {usd(amountNum * 2)} per period.
            </div>
          </div>
          </>
          )}

          {/* actions */}
          <div style={{ padding: "22px 22px 0" }}>
            {!active ? (
              <button className="btn btn-primary btn-block btn-lg tap" disabled={busy || !delegated} style={{ opacity: delegated ? 1 : 0.5 }} onClick={save}>
                {busy ? <Spinner small /> : delegated ? "Start autopilot" : "Authorize Vera first"}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button className="btn btn-glass btn-block btn-lg tap" disabled={busy} onClick={() => setConfirmOpen(true)}>
                  {busy ? <Spinner small /> : "Run now"}
                </button>
                <button className="btn btn-ghost btn-block btn-lg tap" disabled={busy} style={{ color: "var(--neg)" }} onClick={stop}>
                  Turn off autopilot
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* run detail — what Vera did this run */}
      <BottomSheet open={!!detailRun} onClose={() => setDetailRun(null)} title="Autopilot run">
        {detailRun &&
          (() => {
            const r = detailRun;
            const ok = r.status === "success";
            const skipped = r.status === "skipped";
            const hs = r.holdings ?? [];
            const when = new Date(r.ranAt * 1000).toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            });
            return (
              <div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  {ok ? (
                    <Seal size={42} />
                  ) : (
                    <span style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: skipped ? "var(--surface-2)" : "color-mix(in srgb, var(--neg) 16%, transparent)", color: skipped ? "var(--ink-3)" : "var(--neg)" }}>
                      <Icon name={skipped ? "clock" : "info"} size={21} stroke={2.2} />
                    </span>
                  )}
                  <div style={{ fontWeight: 600, fontSize: 19 }}>
                    {ok ? `Invested ${usd(r.amountUsd)}` : skipped ? "Run skipped" : "Run failed"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{when}</div>
                </div>

                {!ok && r.reason && (
                  <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: "var(--r)", background: "var(--surface-2)", fontSize: 13.5, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.5 }}>
                    {r.reason}
                  </div>
                )}

                {ok && hs.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div className="label-eyebrow" style={{ marginBottom: 8 }}>What Vera bought</div>
                    <div className="card" style={{ padding: "4px 14px" }}>
                      {hs.map((h, i) => (
                        <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < hs.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                          <TokenLogo symbol={h.symbol} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: 14 }}>{displayFor(h.symbol).name}</div>
                            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 1 }}>{h.weightPct}% of the plan</div>
                          </div>
                          <div className="tnum" style={{ fontWeight: 600, fontSize: 14 }}>{usd(h.amountUsd)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ok && r.assessedRiskBps != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 16 }}>
                    <span style={{ color: "var(--ink-2)" }}>Risk Vera assessed</span>
                    <span style={{ fontWeight: 500 }}>{Math.round(r.assessedRiskBps / 100)}%</span>
                  </div>
                )}

                {ok && r.txHash && (
                  <a href={txUrl(r.txHash)} target="_blank" rel="noopener noreferrer" className="btn btn-glass btn-block tap" style={{ height: 46, marginTop: 18, fontSize: 14.5, textDecoration: "none" }}>
                    View on Blockscout <Icon name="arrowUR" size={16} />
                  </a>
                )}
              </div>
            );
          })()}
      </BottomSheet>

      {/* run-now confirmation — money action, so confirm with a warning */}
      <BottomSheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Run now?">
        <div style={{ textAlign: "center" }}>
          <p style={{ margin: "0 auto", maxWidth: 320, fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Vera will invest <b style={{ color: "var(--ink)" }}>{usd(config?.amountUsd ?? amountNum)}</b> of your cash
            right now, following your current plan. This places a real on-chain order and can&apos;t be undone.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn btn-ghost btn-block tap" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-block tap"
              onClick={() => {
                setConfirmOpen(false);
                void runNow();
              }}
              disabled={busy}
            >
              {busy ? <Spinner small /> : "Yes, run now"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
