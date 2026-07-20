import { SiteLandingV4, type GroveTeaserV4 } from "@/components/site/SiteLandingV4";
import { getVeraRecordServer } from "@/lib/server/executorLogs";
import { getGroves } from "@/lib/server/groveService";
import { riskLabel, txUrl } from "@/lib/format";

// Marketing site — the public landing at the root URL. The product itself lives
// at /app (see app/app/page.tsx). Vera's on-chain record + latest signed plan
// are read server-side (same source as /agent) and rendered as the hero stats
// and the paper receipt; revalidates hourly. Groves come from the same live
// layer as /groves — if that read fails the section simply doesn't render.
export const revalidate = 3600;

export default async function Home() {
  const [record, grovesData] = await Promise.all([
    getVeraRecordServer().catch(() => null),
    getGroves().catch(() => null),
  ]);
  const latest = record?.recentRecommendations?.[0] ?? null;
  const groves: GroveTeaserV4[] = (grovesData?.groves ?? []).map((g) => ({
    id: g.id,
    ticker: g.ticker,
    name: g.name,
    coverImage: g.coverImage,
  }));
  return (
    <SiteLandingV4
      groves={groves}
      veraStats={{
        plans: record?.totalRecommendations ?? 0,
        invested: record?.totalExecutedUsd ?? 0,
        placed: record?.executedCount ?? 0,
        latest: latest
          ? {
              label: riskLabel(latest.riskScore).label,
              usdc: latest.usdcSpent ?? null,
              txUrl: txUrl(latest.txHash),
            }
          : null,
      }}
    />
  );
}
