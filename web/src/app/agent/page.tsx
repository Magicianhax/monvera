import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { ArrowUpRight } from "lucide-react";
import { getVeraRecordServer, getReputationServer } from "@/lib/server/executorLogs";
import { withTimeout } from "@/lib/server/withTimeout";
import { VERA } from "@/lib/veraData";
import { asset } from "@/lib/assets";
import { addressUrl, txUrl, shortAddress, usd, riskLabel } from "@/lib/format";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import s from "./agent.module.css";

export const metadata: Metadata = pageMeta({
  title: "Vera — a verifiable AI broker agent",
  description:
    "Vera is Monvera's AI broker: she signs every plan with EIP-712 and records it on-chain, so her whole track record can be checked by anyone. Machine-readable identity at /.well-known/agent-card.json.",
  path: "/agent",
});

// Public, world-readable: this page moves no money, so it is not geo-gated.
// Server-rendered from the same on-chain executor log the app reads; revalidates
// hourly. If the record reads back as honest zeros, the page renders a clean
// empty state rather than inventing numbers.
export const revalidate = 3600;

const AGENT_ID = process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1";
const IDENTITY_REGISTRY = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || "";
const REGISTRY_LIVE =
  !!IDENTITY_REGISTRY &&
  IDENTITY_REGISTRY.toLowerCase() !== "0x0000000000000000000000000000000000000000";

const TRUST: { t: string; s: string }[] = [
  { t: "Signed", s: "Every plan is signed by Vera with an EIP-712 signature." },
  { t: "Recorded", s: "Each one is written on-chain, where anyone can verify it on the public explorer." },
  { t: "Open", s: "Anyone can read her full record, no account needed." },
];

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={s.stat}>
      <div className={`${s.statValue} ${accent ? s.statAccent : ""}`}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

// A hung chain scan must not blank this page (same failure the landing hit).
// Honest zeros render the existing empty state, which already says "no plans
// recorded yet" rather than inventing numbers.
const EMPTY_RECORD = { totalRecommendations: 0, totalExecutedUsd: 0, executedCount: 0, recentRecommendations: [] };

export default async function AgentPage() {
  const [record, reputation] = await Promise.all([
    withTimeout(getVeraRecordServer().catch(() => EMPTY_RECORD), 3000, EMPTY_RECORD, "agent:veraRecord"),
    withTimeout(getReputationServer().catch(() => null), 3000, null, "agent:reputation"),
  ]);

  const totalRecs = record.totalRecommendations;
  const totalUsd = record.totalExecutedUsd;
  const executedCount = record.executedCount;
  const recents = record.recentRecommendations;

  return (
    <SiteDocShell
      eyebrow="Verifiable agent"
      title="Meet Vera, an agent you can check"
      lead={
        <>
          {VERA.role[0].toUpperCase() + VERA.role.slice(1)}. She builds plans from real, named companies and funds, and
          every plan she makes is signed and recorded on-chain. That means her whole track record, below, is public and
          verifiable by anyone on the explorer. The machine-readable version lives at{" "}
          <a className={s.inlineLink} href="/.well-known/agent-card.json">/.well-known/agent-card.json</a>.
        </>
      }
    >
      {/* identity lockup — verified agent number + registry, straight from chain config */}
      <section className={s.identity}>
        <img
          src={asset("/brand/vera-mascot.webp")}
          alt="Vera, Monvera's investing agent"
          width={78}
          height={116}
          decoding="async"
          className={s.mascot}
        />
        <div className={s.idBody}>
          <div className={s.verified}>
            <span className={s.verifiedLabel}>Verified agent</span>
            <span className={s.agentNo}>№{AGENT_ID}</span>
          </div>
          <p className={s.idNote}>
            {VERA.name}{" "}holds this number in Monvera&apos;s IdentityRegistry on Robinhood Chain, plus a canonical
            ERC-8004 identity on Base.
          </p>
          <div className={s.idLinks}>
            {REGISTRY_LIVE ? (
              <a className={s.registryLink} href={addressUrl(IDENTITY_REGISTRY)} target="_blank" rel="noopener noreferrer">
                IdentityRegistry <span className={s.mono}>{shortAddress(IDENTITY_REGISTRY)}</span>
              </a>
            ) : (
              <span className={s.muted}>Registry link goes live when the contract is deployed on Robinhood Chain.</span>
            )}
            {reputation !== null && reputation !== undefined && (
              <span className={s.rep}>
                Reputation score <b>{reputation.toString()}</b>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* her record, live on-chain */}
      <p className={s.recordHead}>Her record, live on-chain</p>
      <div className={s.stats}>
        <Stat label="Plans built" value={totalRecs.toLocaleString("en-US")} />
        <Stat label="Invested" value={usd(totalUsd)} accent />
        <Stat label="Placed" value={executedCount.toLocaleString("en-US")} />
      </div>

      {/* why you can trust the record */}
      <p className={s.quote}>&ldquo;{VERA.blurb}&rdquo;</p>
      <ul className={s.trust}>
        {TRUST.map((x) => (
          <li key={x.t} className={s.trustItem}>
            <div className={s.trustTitle}>{x.t}</div>
            <div className={s.trustNote}>{x.s}</div>
          </li>
        ))}
      </ul>

      {/* recorded recommendations — real, from the on-chain log */}
      <h2 className={s.recsHead}>Recorded recommendations</h2>
      {recents.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyTitle}>No plans recorded yet</div>
          <p className={s.emptyNote}>
            Every plan Vera signs will appear here, permanently. The first one is written the moment she places it
            on-chain.
          </p>
        </div>
      ) : (
        <ul className={s.recs}>
          {recents.map((r, i) => {
            const placed = r.usdcSpent !== undefined;
            const risk = riskLabel(r.riskScore);
            return (
              <li key={r.txHash + i} className={s.rec}>
                <a className={s.recLink} href={txUrl(r.txHash)} target="_blank" rel="noopener noreferrer">
                  <div className={s.recBody}>
                    <div className={s.recTitle}>
                      {risk.label} plan{placed ? ` · ${usd(r.usdcSpent as number)}` : ""}
                    </div>
                    <div className={s.recMeta}>{placed ? "Placed on-chain" : "Recommended on-chain"}</div>
                  </div>
                  <ArrowUpRight className={s.recArrow} size={17} strokeWidth={2} aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </SiteDocShell>
  );
}
