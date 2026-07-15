import "server-only";

// $MONVERA supply, for public consumption (e.g. CoinGecko supply polling).
//
// Total supply is fixed at 1,000,000,000 (no mint, no burn), read on-chain.
// Circulating is derived ON-CHAIN: total minus the balance still held in the team
// vesting/lock contract (the Sniper Tax Buyback 12.9% + Developer 7.7% tranches,
// ~20.6% at launch). Reading the contract's live balance tracks real vesting
// releases and the sniper buyback automatically. If the on-chain read fails, it
// falls back to the disclosed vesting schedule (Sniper: 3mo lock then 9mo linear;
// Developer: 6mo cliff then 6mo linear). Everything is fully unlocked by 13 Jul 2027.
import { createPublicClient, http, parseAbi } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA } from "@/lib/monveraToken";

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });
const ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const MAX = 1_000_000_000; // fixed

// Team vesting/lock contract holding the still-locked Sniper Tax Buyback (12.9%)
// and Developer (7.7%) tranches. Its live balance is the non-circulating supply.
export const LOCKED_WALLET = "0x69DDB2242C7cF4BEB978583a817a44Cea7cd9bdC" as `0x${string}`;

// Fallback schedule — only used if the on-chain balance read fails.
const LAUNCH_MS = Date.UTC(2026, 6, 13); // 13 Jul 2026, 00:00 UTC (month is 0-indexed)
const MONTH_MS = (365.25 / 12) * 86_400_000;
const SNIPER = 129_000_000;
const DEVELOPER = 77_000_000;
function scheduledLock(nowMs: number): number {
  const m = Math.max(0, (nowMs - LAUNCH_MS) / MONTH_MS);
  const sniper = m <= 3 ? SNIPER : m >= 12 ? 0 : SNIPER * (1 - (m - 3) / 9);
  const dev = m <= 6 ? DEVELOPER : m >= 12 ? 0 : DEVELOPER * (1 - (m - 6) / 6);
  return sniper + dev;
}

export interface SupplyData {
  decimals: number;
  maxSupply: number;
  totalSupply: number;
  circulatingSupply: number;
  lockedSupply: number;
  lockedSource: "onchain" | "schedule";
  asOf: string;
}

let cache: { at: number; data: SupplyData } | null = null;

export async function getSupply(): Promise<SupplyData> {
  const now = Date.now();
  if (cache && now - cache.at < 300_000) return cache.data;

  const dec = BigInt(10) ** BigInt(MONVERA.decimals);

  let total = MAX;
  try {
    const raw = (await client.readContract({
      address: MONVERA.address,
      abi: ABI,
      functionName: "totalSupply",
    })) as bigint;
    total = Number(raw / dec);
  } catch {
    /* fixed supply — fall back to the constant */
  }

  // Prefer the live locked-contract balance; fall back to the vesting schedule.
  let locked = Math.round(scheduledLock(now));
  let lockedSource: "onchain" | "schedule" = "schedule";
  try {
    const raw = (await client.readContract({
      address: MONVERA.address,
      abi: ABI,
      functionName: "balanceOf",
      args: [LOCKED_WALLET],
    })) as bigint;
    locked = Number(raw / dec);
    lockedSource = "onchain";
  } catch {
    /* keep schedule fallback */
  }
  locked = Math.min(total, Math.max(0, locked));

  const data: SupplyData = {
    decimals: MONVERA.decimals,
    maxSupply: MAX,
    totalSupply: total,
    circulatingSupply: total - locked,
    lockedSupply: locked,
    lockedSource,
    asOf: new Date(now).toISOString(),
  };
  cache = { at: now, data };
  return data;
}
