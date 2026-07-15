// GET /api/supply — public $MONVERA supply for CoinGecko-style polling.
// No auth, permissive CORS, cached 5 min (circulating changes slowly, linearly).
// Not in the geo-gate matcher, so it's reachable from anywhere.
import { getSupply, LOCKED_WALLET } from "@/lib/server/supply";
import { MONVERA } from "@/lib/monveraToken";
import { EXPLORER_URL } from "@/lib/chain";

export const revalidate = 0;

const HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  "Access-Control-Allow-Origin": "*",
};

export async function GET() {
  const s = await getSupply();
  return Response.json(
    {
      name: "Monvera",
      symbol: MONVERA.symbol,
      contract: MONVERA.address,
      chain: "Robinhood Chain",
      decimals: s.decimals,
      max_supply: String(s.maxSupply),
      total_supply: String(s.totalSupply),
      circulating_supply: String(s.circulatingSupply),
      locked_supply: String(s.lockedSupply),
      locked_wallet: LOCKED_WALLET,
      locked_source: s.lockedSource,
      explorer: `${EXPLORER_URL}/token/${MONVERA.address}`,
      as_of: s.asOf,
      notes:
        "Circulating = total supply minus the balance held in the team vesting/lock contract (locked_wallet: the Sniper Tax Buyback 12.9% + Developer 7.7% tranches), read on-chain; falls back to the disclosed vesting schedule if the read fails. Fully unlocked 13 Jul 2027.",
    },
    { headers: HEADERS },
  );
}
