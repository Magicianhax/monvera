// GET /api/supply/total — plain-text $MONVERA total supply (whole tokens).
// For CoinGecko's "Total Supply API" field. No auth, permissive CORS, 5-min cache.
import { getSupply } from "@/lib/server/supply";

export const revalidate = 0;

export async function GET() {
  const s = await getSupply();
  return new Response(String(s.totalSupply), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
