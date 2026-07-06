import { SiteLanding } from "@/components/site/SiteLanding";
import { getVeraRecordServer } from "@/lib/server/executorLogs";

// Marketing site — the public landing at the root URL. The product itself lives
// at /app (see app/app/page.tsx). Vera's on-chain record is read server-side
// (same source as /agent) and embedded as a live stat band; revalidates hourly.
export const revalidate = 3600;

export default async function Home() {
  const record = await getVeraRecordServer().catch(() => null);
  const veraStats = record
    ? {
        plans: record.totalRecommendations,
        invested: record.totalExecutedUsd,
        placed: record.executedCount,
      }
    : null;
  return <SiteLanding veraStats={veraStats} />;
}
