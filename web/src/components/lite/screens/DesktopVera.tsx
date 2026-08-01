"use client";

// Desktop Vera — the agent's public profile + on-chain track record. A profile
// hero (VeraOrb + name/role + blurb), three headline stats, a "Track record" table
// of every recommendation she's signed, and her ERC-8004 on-chain identity. All
// live data: useAgentIdentity + useVeraRecord (same as mobile), only the desktop
// composition is new. Risk label/tone is derived per-recommendation from riskScore.
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { VeraOrb } from "@/components/design";
import { addressUrl, shortAddress } from "@/lib/format";
import { VERA } from "@/lib/veraData";
import { DIcon, usd, Panel } from "./deskKit";

type Go = (screen: string, params?: Record<string, unknown>) => void;

// riskScore is basis points (0–10000); /100 → a 0–100 scale, then bucketed.
function riskMeta(riskScore: number): { label: string; tone: string } {
  const v = riskScore / 100;
  if (v < 25) return { label: "Steady", tone: "var(--pos)" };
  if (v < 50) return { label: "Balanced", tone: "var(--primary)" };
  if (v < 75) return { label: "Bold", tone: "var(--accent)" };
  return { label: "Spicy", tone: "var(--neg)" };
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Panel style={{ flex: "1 1 160px", padding: "16px 18px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--ink-3)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 26, fontWeight: 600, marginTop: 4, color: tone ?? "var(--ink)" }}>{value}</div>
    </Panel>
  );
}

export function DesktopVera({ go }: { go: Go }) {
  const { data: identity } = useAgentIdentity();
  const { data: record } = useVeraRecord();
  const recents = record?.recentRecommendations ?? [];

  return (
    <div className="deskscreen">
      <div className="rise" style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px 60px" }}>
        {/* profile hero */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <VeraOrb size={48} />
            <div>
              <h1 className="serif" style={{ margin: 0, fontSize: 27, lineHeight: 1.1 }}>{VERA.name}</h1>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 1 }}>{VERA.role}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-outline" onClick={() => go("autopilot")} style={{ display: "flex", gap: 8 }}><DIcon name="sliders" size={17} /> Autopilot</button>
            <button className="btn btn-primary" onClick={() => go("goal")} style={{ display: "flex", gap: 8 }}><DIcon name="sparkle" size={17} stroke={2} /> Build a plan</button>
          </div>
        </header>

        {/* headline stats */}
        <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
          <Stat label="Plans built" value={String(record?.totalRecommendations ?? 0)} />
          <Stat label="Invested" value={usd(record?.totalExecutedUsd ?? 0)} tone="var(--pos)" />
          <Stat label="Placed on-chain" value={String(record?.executedCount ?? 0)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 22, marginTop: 22, alignItems: "start" }}>
          {/* track record */}
          <Panel style={{ minWidth: 0 }}>
            <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--line-2)" }}>
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Track record</h2>
            </div>
            {recents.length === 0 ? (
              <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>No recorded plans yet.</div>
            ) : (
              <div style={{ padding: "8px 10px 10px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 44px", padding: "0 12px 8px", borderBottom: "1px solid var(--line)", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                  <span>Plan</span>
                  <span style={{ textAlign: "right" }}>Amount</span>
                  <span style={{ textAlign: "right" }}>Status</span>
                  <span style={{ textAlign: "right" }}>Proof</span>
                </div>
                {recents.map((r) => {
                  const placed = r.usdcSpent !== undefined;
                  const { label, tone } = riskMeta(r.riskScore);
                  return (
                    <button
                      key={r.planId}
                      className="desk-row"
                      onClick={() => go("receipt", { title: placed ? "Invested in a plan" : "Plan recommended", amount: placed ? r.usdcSpent : undefined, txHash: r.txHash })}
                      style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 44px", alignItems: "center", width: "100%", padding: "13px 12px", textAlign: "left", borderRadius: 10, borderBottom: "1px solid var(--line-2)" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: tone }} />
                        <span style={{ fontWeight: 500, fontSize: 14.5 }}>{label} plan</span>
                      </span>
                      <span className="tnum" style={{ textAlign: "right", fontWeight: 600, fontSize: 14.5 }}>{placed ? usd(r.usdcSpent as number) : "—"}</span>
                      <span style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: placed ? "var(--pos)" : "var(--ink-3)" }}>{placed ? "Invested" : "Recommended"}</span>
                      <span style={{ display: "inline-flex", justifyContent: "flex-end", color: "var(--ink-3)" }}><DIcon name="shield" size={17} /></span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* identity + about */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            <Panel style={{ padding: 18 }}>
              <h2 style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 600 }}>On-chain identity</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-3)" }}>Agent</span>
                  <span className="tnum" style={{ fontWeight: 600 }}>№{String(identity?.agentId ?? 1)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-3)" }}>Standard</span>
                  <span style={{ fontWeight: 600 }}>ERC-8004</span>
                </div>
                {identity?.registry && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--ink-3)" }}>Registry</span>
                    <a href={addressUrl(identity.registry)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--primary)" }}>{shortAddress(identity.registry)}</a>
                  </div>
                )}
                {identity?.signer && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--ink-3)" }}>Signer</span>
                    <a href={addressUrl(identity.signer)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--primary)" }}>{shortAddress(identity.signer)}</a>
                  </div>
                )}
              </div>
            </Panel>

            <Panel style={{ padding: 18 }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 14.5, fontWeight: 600 }}>About {VERA.name}</h2>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{VERA.blurb}</p>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
