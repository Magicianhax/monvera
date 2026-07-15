import "server-only";

// $MONVERA supply, for public consumption (e.g. CoinGecko supply polling).
//
// Total supply is fixed at 1,000,000,000 (no mint, no burn) and read on-chain
// with a constant fallback. Circulating = total minus the two contractually-locked
// tranches, computed from the disclosed Virtuals vesting schedule:
//   • Sniper Tax Buyback (12.9%, 129,000,000): locked 3 months, then linear over 9.
//   • Developer (7.7%, 77,000,000): 6-month cliff, then linear over 6.
// Pledger (69.3%) and Liquidity Pool (10.1%) are unlocked at launch and count as
// circulating from day one. Everything is fully unlocked by 13 Jul 2027.
import { createPublicClient, http, parseAbi } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA } from "@/lib/monveraToken";

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });
const ABI = parseAbi(["function totalSupply() view returns (uint256)"]);

const MAX = 1_000_000_000; // fixed
const LAUNCH_MS = Date.UTC(2026, 6, 13); // 13 Jul 2026, 00:00 UTC (month is 0-indexed)
const MONTH_MS = (365.25 / 12) * 86_400_000;
const SNIPER = 129_000_000; // 12.9% — 3mo lock, then 9mo linear
const DEVELOPER = 77_000_000; // 7.7% — 6mo cliff, then 6mo linear

export interface SupplyData {
  decimals: number;
  maxSupply: number;
  totalSupply: number;
  circulatingSupply: number;
  lockedSupply: number;
  asOf: string;
}

/** Tokens still locked at `nowMs`, from the disclosed vesting schedule. */
function lockedAt(nowMs: number): number {
  const m = Math.max(0, (nowMs - LAUNCH_MS) / MONTH_MS);
  const sniper = m <= 3 ? SNIPER : m >= 12 ? 0 : SNIPER * (1 - (m - 3) / 9);
  const dev = m <= 6 ? DEVELOPER : m >= 12 ? 0 : DEVELOPER * (1 - (m - 6) / 6);
  return sniper + dev;
}

let cache: { at: number; data: SupplyData } | null = null;

export async function getSupply(): Promise<SupplyData> {
  const now = Date.now();
  if (cache && now - cache.at < 300_000) return cache.data;

  let total = MAX;
  try {
    const raw = (await client.readContract({
      address: MONVERA.address,
      abi: ABI,
      functionName: "totalSupply",
    })) as bigint;
    total = Number(raw / BigInt(10) ** BigInt(MONVERA.decimals));
  } catch {
    /* fixed supply — fall back to the constant */
  }

  const locked = Math.min(total, Math.round(lockedAt(now)));
  const data: SupplyData = {
    decimals: MONVERA.decimals,
    maxSupply: MAX,
    totalSupply: total,
    circulatingSupply: total - locked,
    lockedSupply: locked,
    asOf: new Date(now).toISOString(),
  };
  cache = { at: now, data };
  return data;
}
