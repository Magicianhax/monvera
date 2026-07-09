import { SiteLanding } from "@/components/site/SiteLanding";
import { getVeraRecordServer } from "@/lib/server/executorLogs";
import { getPublicStrategies } from "@/lib/server/strategies";
import { riskLabel, txUrl } from "@/lib/format";

// Marketing site — the public landing at the root URL. The product itself lives
// at /app (see app/app/page.tsx). Vera's on-chain identity + latest signed plan
// are read server-side (same source as /agent) and embedded as a proof card;
// revalidates hourly.
export const revalidate = 3600;

const AGENT_ID = process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1";
const IDENTITY_REGISTRY = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || "";
const REGISTRY_LIVE =
  !!IDENTITY_REGISTRY &&
  IDENTITY_REGISTRY.toLowerCase() !== "0x0000000000000000000000000000000000000000";

export default async function Home() {
  // The strategy preview shows the real book (same engine as /strategies). If it
  // cannot be read, the section simply does not render rather than showing stubs.
  const [record, book] = await Promise.all([
    getVeraRecordServer().catch(() => null),
    getPublicStrategies().catch(() => null),
  ]);
  const latest = record?.recentRecommendations?.[0] ?? null;
  const vera = {
    agentId: AGENT_ID,
    registryLive: REGISTRY_LIVE,
    plans: record?.totalRecommendations ?? 0,
    invested: record?.totalExecutedUsd ?? 0,
    placed: record?.executedCount ?? 0,
    latest: latest
      ? {
          label: riskLabel(latest.riskScore).label,
          placed: latest.usdcSpent !== undefined,
          usdc: latest.usdcSpent ?? null,
          txUrl: txUrl(latest.txHash),
        }
      : null,
  };
  return <SiteLanding veraStats={vera} strategies={book?.strategies ?? []} />;
}
