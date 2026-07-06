import type { Metadata } from "next";
import { getVeraRecordServer, getReputationServer } from "@/lib/server/executorLogs";
import { VERA } from "@/lib/veraData";
import { asset } from "@/lib/assets";
import { addressUrl, txUrl, shortAddress, usd, riskLabel } from "@/lib/format";

export const metadata: Metadata = {
  title: "Vera, a verifiable AI agent",
  description:
    "Vera is Monvera's investing agent: she signs every plan with EIP-712 and records it permanently on-chain, so her whole track record can be checked by anyone. Machine-readable identity at /.well-known/agent-card.json.",
  alternates: { canonical: "/agent" },
  openGraph: {
    title: "Monvera · Vera, a verifiable AI agent",
    description:
      "Every plan Vera signs is recorded on-chain and open for anyone to check. Her verified agent number, registry, and full record, in public.",
    url: "/agent",
  },
};

// Public, world-readable: this page moves no money, so it is not geo-gated.
// Server-rendered from the same on-chain executor log the app reads; revalidates
// hourly. While the executor + registry are being redeployed on Robinhood Chain
// the record reads back as honest zeros, and the page renders a clean 0-state.
export const revalidate = 3600;

const AGENT_ID = process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1";
const IDENTITY_REGISTRY = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || "";
const REGISTRY_LIVE =
  !!IDENTITY_REGISTRY &&
  IDENTITY_REGISTRY.toLowerCase() !== "0x0000000000000000000000000000000000000000";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ flex: 1, background: "var(--glass-bg-2)", borderRadius: "var(--r)", padding: "15px 6px", textAlign: "center" }}>
      <div className="tnum" style={{ fontSize: 22, fontWeight: 600, color: accent ? "var(--pos)" : "var(--ink)" }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-2)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

const TRUST: { t: string; s: string }[] = [
  { t: "Signed", s: "Every plan is signed by Vera with an EIP-712 signature." },
  { t: "Recorded", s: "Each one is written on-chain, so it cannot be edited after the fact." },
  { t: "Open", s: "Anyone can read her full record, no account needed." },
];

export default async function AgentPage() {
  const [record, reputation] = await Promise.all([
    getVeraRecordServer(),
    getReputationServer().catch(() => null),
  ]);

  const totalRecs = record.totalRecommendations;
  const totalUsd = record.totalExecutedUsd;
  const executedCount = record.executedCount;
  const recents = record.recentRecommendations;

  return (
    <div className="stax" data-mode="light" style={{ minHeight: "100vh", background: "var(--app-bg, var(--paper))" }}>
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 22px 80px" }}>
        <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)", margin: 0 }}>
          Monvera · verifiable agent
        </p>
        <h1 className="serif" style={{ fontSize: 40, lineHeight: 1.1, letterSpacing: "-.02em", margin: "10px 0 14px" }}>
          Meet Vera, an agent you can check.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink-2)", margin: 0, maxWidth: 560 }}>
          {VERA.role[0].toUpperCase() + VERA.role.slice(1)}. She builds plans from real, named companies
          and funds, and every plan she makes is signed and recorded on-chain. That means her whole track
          record, below, is public and cannot be rewritten later. The machine-readable version lives at{" "}
          <a href="/.well-known/agent-card.json" style={{ color: "var(--accent)", fontWeight: 600 }}>
            /.well-known/agent-card.json
          </a>
          .
        </p>

        {/* identity lockup — verified agent number + registry, straight from chain config */}
        <section className="card" style={{ marginTop: 28, padding: "22px", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <img
            src={asset("/brand/vera-mascot.webp")}
            alt="Vera"
            width={72}
            height={108}
            decoding="async"
            style={{ height: 108, width: "auto", display: "block", flex: "none" }}
          />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "inline-flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Verified agent</span>
              <span className="serif" style={{ fontSize: 22, fontWeight: 500, color: "var(--primary)", lineHeight: 1 }}>
                №{AGENT_ID}
              </span>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
              {VERA.name} holds this number in Monvera&apos;s IdentityRegistry on Robinhood Chain, plus a
              canonical ERC-8004 identity on Base.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 10 }}>
              {REGISTRY_LIVE ? (
                <a
                  href={addressUrl(IDENTITY_REGISTRY)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}
                >
                  IdentityRegistry <span className="mono" style={{ fontWeight: 500 }}>{shortAddress(IDENTITY_REGISTRY)}</span>
                </a>
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  Registry link goes live when the contract is deployed on Robinhood Chain.
                </span>
              )}
              {reputation !== null && reputation !== undefined && (
                <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  Reputation score <b style={{ color: "var(--ink)" }}>{reputation.toString()}</b>
                </span>
              )}
            </div>
          </div>
        </section>

        {/* her record, live on-chain */}
        <section className="card" style={{ marginTop: 20, padding: "20px 22px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", padding: "0 2px 12px" }}>
            Her record, live on-chain
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Stat label="Plans built" value={totalRecs.toLocaleString("en-US")} />
            <Stat label="Invested" value={usd(totalUsd)} accent />
            <Stat label="Placed" value={executedCount.toLocaleString("en-US")} />
          </div>
        </section>

        {/* why you can trust the record */}
        <section className="card" style={{ marginTop: 20, padding: "18px 22px" }}>
          <p style={{ margin: "0 0 6px", fontSize: 15, lineHeight: 1.55, color: "var(--ink)" }}>
            &ldquo;{VERA.blurb}&rdquo;
          </p>
          {TRUST.map((x, i) => (
            <div
              key={x.t}
              style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0 4px", borderTop: i === 0 ? "1px solid var(--line-2)" : "1px solid var(--line-2)", marginTop: i === 0 ? 12 : 0 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-.01em" }}>{x.t}</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.5 }}>{x.s}</div>
              </div>
            </div>
          ))}
        </section>

        {/* recorded recommendations — REAL, from the on-chain log */}
        <section style={{ marginTop: 28 }}>
          <h2 className="serif" style={{ fontSize: 24, letterSpacing: "-.015em", margin: "0 0 12px" }}>
            Recorded recommendations
          </h2>
          {recents.length === 0 ? (
            <div className="card" style={{ padding: "28px 20px", textAlign: "center", color: "var(--ink-2)" }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>No plans recorded yet</div>
              <div style={{ fontSize: 13.5, marginTop: 5, lineHeight: 1.5, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
                Every plan Vera signs will appear here, permanently. The first one is written the moment she
                places it on-chain.
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "4px 18px" }}>
              {recents.map((r, i) => {
                const placed = r.usdcSpent !== undefined;
                const risk = riskLabel(r.riskScore);
                return (
                  <a
                    key={r.txHash + i}
                    href={txUrl(r.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 0",
                      borderBottom: i < recents.length - 1 ? "1px solid var(--line-2)" : "none",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {risk.label} plan{placed ? ` · ${usd(r.usdcSpent as number)}` : ""}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                        {placed ? "Placed on-chain" : "Recommended on-chain"}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>
                      {shortAddress(r.txHash)}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6, marginTop: 16 }}>
            Every plan is signed and recorded on-chain, so this record cannot be edited after the fact. Past
            results do not promise future ones.
          </p>
        </section>
      </main>
    </div>
  );
}
