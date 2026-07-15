// GET /api/supply/circulating — plain-text $MONVERA circulating supply (whole
// tokens): total minus the locked Sniper Tax Buyback + Developer tranches, from
// the vesting schedule. For CoinGecko's "Circulating Supply API" field.
import { getSupply } from "@/lib/server/supply";

export const revalidate = 0;

export async function GET() {
  const s = await getSupply();
  return new Response(String(s.circulatingSupply), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
