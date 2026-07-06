"use client";

// Vera — her home: who she is (verifiable on-chain identity), what she's done
// (REAL track record from the StaxExecutor log via useVeraRecord), and the two
// ways to put her to work: build a plan now, or hand her Autopilot. Restructured
// to the rounded/glass theme with one obvious primary action, real company logos
// (translate, never expose), and her honest, on-chain record. Empty history
// degrades to an honest 0-state.
import type { ReactNode } from "react";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { VERA } from "@/lib/veraData";
import { Icon, VeraOrb, SectionTitle, Seal, CountUp, type IconName } from "@/components/design";
import { VeraMascot } from "@/components/design/VeraMascot";
import { displayFor } from "@/lib/displayAssets";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { addressUrl, shortAddress, usd, riskLabel } from "@/lib/format";

// A handful of the real, recognizable names Vera builds from — shown as real
// company logos so a newcomer sees Apple and the S&P 500, never a token address.
const SHOWCASE = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN"];

const iconChip = (bg: string, fg: string) => ({
  width: 38,
  height: 38,
  borderRadius: "var(--r-sm)",
  flex: "none" as const,
  display: "grid" as const,
  placeItems: "center" as const,
  background: bg,
  color: fg,
});

export function VeraScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { data: identity, isLoading: identityLoading } = useAgentIdentity();
  const { data: record, isLoading: recordLoading } = useVeraRecord();

  const totalRecs = record?.totalRecommendations ?? 0;
  const totalUsd = record?.totalExecutedUsd ?? 0;
  const executedCount = record?.executedCount ?? 0;
  const recents = record?.recentRecommendations ?? [];

  const trustPoints: { icon: IconName; t: string; s: string }[] = [
    { icon: "signature", t: "Signed", s: "Every plan is signed by me" },
    { icon: "lock", t: "Recorded", s: "Saved permanently, can't be edited" },
    { icon: "globe", t: "Open", s: "Anyone can check my record" },
  ];

  const stats: { value: ReactNode; label: string; color?: string; w: number }[] = [
    { value: <CountUp to={totalRecs} prefix="" dp={0} />, label: "Plans built", w: 34 },
    { value: <CountUp to={totalUsd} />, label: "Invested", color: "var(--pos)", w: 56 },
    { value: <CountUp to={executedCount} prefix="" dp={0} />, label: "Placed", w: 30 },
  ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* hero — Vera + her verifiable on-chain identity */}
      <div className="anim-rise" style={{ padding: "20px 22px 0", textAlign: "center" }}>
        <div style={{ display: "inline-block", marginBottom: 8 }}>
          <VeraMascot size={140} />
        </div>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.01em" }}>
          {VERA.name}
        </h1>
        <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 2 }}>{VERA.role}</div>

        {/* credential lockup — gradient seal + brand-serif agent number, not a chip */}
        <div style={{ marginTop: 15, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Seal size={23} />
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>Verified agent</span>
            <span className="serif" style={{ fontSize: 19, fontWeight: 600, color: "var(--primary)", lineHeight: 1 }}>
              №{identity ? identity.agentId.toString() : "1"}
            </span>
          </div>
          {identityLoading && !identity && (
            <span className="skeleton" style={{ display: "inline-block", width: 190, height: 12, borderRadius: 6 }} />
          )}
          {identity && (
            <a
              href={addressUrl(identity.registry)}
              target="_blank"
              rel="noopener noreferrer"
              className="tap"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" }}
            >
              IdentityRegistry <span className="mono">{shortAddress(identity.registry)}</span>
              <Icon name="arrowUR" size={12} />
            </a>
          )}
        </div>
      </div>

      {/* track record — REAL, from the on-chain executor log. Glass stat tiles. */}
      <div className="anim-rise" style={{ animationDelay: ".05s", padding: "22px 22px 0" }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)", padding: "0 2px 12px" }}>
            Her record, live on-chain
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {stats.map((s) => (
              <div
                key={s.label}
                style={{ flex: 1, background: "var(--glass-bg-2)", borderRadius: "var(--r)", padding: "13px 6px", textAlign: "center" }}
              >
                <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: s.color }}>
                  {recordLoading ? (
                    <span className="skeleton" style={{ display: "inline-block", width: s.w, height: 20, borderRadius: 6 }} />
                  ) : (
                    s.value
                  )}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* primary action — the one obvious thing to do: build a plan. */}
      <div className="anim-rise" style={{ animationDelay: ".07s", padding: "22px 22px 0" }}>
        <button
          className="tap"
          onClick={() => go("goal")}
          style={{
            width: "100%",
            padding: 18,
            display: "flex",
            alignItems: "center",
            gap: 14,
            textAlign: "left",
            border: "none",
            borderRadius: "var(--r-lg)",
            background: "var(--hero-grad)",
            color: "var(--primary-ink)",
            boxShadow: "var(--shadow)",
          }}
        >
          <VeraOrb size={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>Build a plan with Vera</div>
            <div style={{ fontSize: 13.5, marginTop: 3, lineHeight: 1.4, opacity: 0.88 }}>
              Tell me a goal, I&apos;ll build it in seconds.
            </div>
          </div>
          <Icon name="chevR" size={20} style={{ flex: "none", opacity: 0.9 }} />
        </button>
      </div>

      {/* secondary action — Autopilot, a slimmer row so it clearly recedes. */}
      <div className="anim-rise" style={{ animationDelay: ".08s", padding: "12px 22px 0" }}>
        <button
          className="card tap"
          onClick={() => go("autopilot")}
          style={{ width: "100%", padding: 14, display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}
        >
          <span style={iconChip("var(--primary-soft)", "var(--primary)")}>
            <Icon name="spark" size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Autopilot</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1, lineHeight: 1.4 }}>
              Invest on a schedule, within limits you set.
            </div>
          </div>
          <Icon name="chevR" size={17} style={{ color: "var(--ink-3)", flex: "none" }} />
        </button>
      </div>

      {/* what she builds from — REAL company logos, not tokens. */}
      <div style={{ padding: "22px 22px 0" }}>
        <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: "none", display: "flex" }} aria-hidden>
            {SHOWCASE.map((s, i) => (
              <span
                key={s}
                style={{ marginLeft: i === 0 ? 0 : -12, borderRadius: "50%", background: "var(--surface)", padding: 1.5, position: "relative", zIndex: SHOWCASE.length - i }}
              >
                <TokenLogo symbol={s} size={30} />
              </span>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
            Every plan is built from real companies and funds, like{" "}
            <b style={{ color: "var(--ink)" }}>{displayFor("AAPL").name}</b>,{" "}
            <b style={{ color: "var(--ink)" }}>{displayFor("NVDA").name}</b>, and the{" "}
            <b style={{ color: "var(--ink)" }}>{displayFor("SPY").name}</b>.
          </div>
        </div>
      </div>

      {/* why trust me — quote + a clean row list (not three nested cards) */}
      <div style={{ padding: "22px 22px 0" }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <VeraOrb size={32} />
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--ink)" }}>
              &ldquo;{VERA.blurb}&rdquo;
            </p>
          </div>
          <div style={{ marginTop: 14 }}>
            {trustPoints.map((x) => (
              <div
                key={x.t}
                style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 0", borderTop: "1px solid var(--line-2)" }}
              >
                <span style={iconChip("var(--accent-soft)", "var(--accent)")}>
                  <Icon name={x.icon} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: "-.01em" }}>{x.t}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>{x.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* recorded recommendations — REAL, from the on-chain log */}
      <div style={{ padding: "22px 22px 0" }}>
        <SectionTitle>Recorded recommendations</SectionTitle>
        {recordLoading && recents.length === 0 ? (
          <div className="card" style={{ padding: "4px 16px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderBottom: i < 2 ? "1px solid var(--line-2)" : "none" }}
              >
                <div className="skeleton" style={{ width: 38, height: 38, borderRadius: "var(--r-sm)", flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "55%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "35%", height: 11, borderRadius: 6, marginTop: 7 }} />
                </div>
              </div>
            ))}
          </div>
        ) : recents.length === 0 ? (
          <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>No plans recorded yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Every plan Vera builds is signed and written on-chain. The first one will appear here, permanently.
            </div>
          </div>
        ) : (
          <div className="card stagger-in" style={{ padding: "4px 16px" }}>
            {recents.map((r, i) => {
              const placed = r.usdcSpent !== undefined;
              const risk = riskLabel(r.riskScore);
              return (
                <button
                  key={r.txHash + i}
                  className="row tap"
                  onClick={() =>
                    go("receipt", {
                      title: placed ? "Invested in a plan" : "Plan recommended",
                      amount: placed ? r.usdcSpent : undefined,
                      txHash: r.txHash,
                    })
                  }
                  style={{ padding: "13px 0", borderBottom: i < recents.length - 1 ? "1px solid var(--line-2)" : "none" }}
                >
                  <span style={iconChip("var(--primary-soft)", "var(--primary)")}>
                    <Icon name={placed ? "check" : "shield"} size={18} stroke={placed ? 2.4 : undefined} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {risk.label} plan{placed ? ` · ${usd(r.usdcSpent as number)}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                      {placed ? "Placed on-chain" : "Recommended on-chain"}
                    </div>
                  </div>
                  <Icon name="chevR" size={16} style={{ color: "var(--ink-3)" }} />
                </button>
              );
            })}
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center", padding: "14px 30px 0", lineHeight: 1.5 }}>
          Every plan is signed and recorded on-chain, so this record can&apos;t be edited after the fact. Past
          results don&apos;t promise future ones.
        </p>
      </div>
    </div>
  );
}
