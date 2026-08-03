"use client";

// useStaking — reads + actions for $MONVERA staking, driven by whichever
// wallet adapter is passed in (Privy embedded in-app, injected on /stake).
// Reads always go through the dedicated staking-chain client, so the page is
// fully readable with no wallet connected at all.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createWalletClient, custom, parseUnits } from "viem";
import type { StakingWallet } from "@/hooks/useStakingWallet";
import { useRefreshBalances } from "@/hooks/useBalances";
import {
  STAKING_ADDRESSES,
  seasonDistributorAbi,
  stakingAbi,
  stakingChain,
  stakingClient,
  stakingTokenAbi,
} from "@/lib/staking";
import { loadClaimManifest } from "@/lib/season/claim";
import { leafOf, verifyProof } from "@/lib/season/compute";
import { explainError } from "@/lib/explainError";

const ZERO_ROOT = `0x${"0".repeat(64)}` as const;

export interface StakerRow {
  address: `0x${string}`;
  staked: bigint;
  weight: bigint;
  /** Season rewards earned so far, from the off-chain preview. Undefined when
   *  the rewards endpoint is unavailable or no season is running. */
  earned?: bigint;
}

/** Off-chain season reward figures, computed by the daily-bucket merkle pipeline
 *  and served from /api/staking/rewards. Undefined until that endpoint is live,
 *  in which case the reward tiles read "—" and the page still renders on-chain
 *  data. Amounts are raw 18dp wei. The model is pure proportional and uncapped:
 *  each day's bucket is split by that day's stake-time, so bankedSoFar (the sum
 *  of finished days) is a monotone non-decreasing floor — a late staker never
 *  dilutes a day that already closed, and the more you stake the more you earn. */
export interface StakerRewards {
  bankedSoFar: bigint;
  todayAccruing: bigint;
}

export interface StakingSnapshot {
  wallet: bigint;
  staked: bigint;
  pending: bigint;
  unlockAt: number; // unix seconds, 0 = none
  weight: bigint;
  totalWeight: bigint;
  totalStaked: bigint;
  cooldownSeconds: number;
  leaderboard: StakerRow[];
  rewards?: StakerRewards;
}

/** A season this wallet can (or already did) claim. Assembled from the published
 *  manifest + the on-chain distributor, with the proof verified against the
 *  on-chain root so a bad manifest can only ever drop an entry, never forge one. */
export interface ClaimableSeason {
  seasonId: number;
  amount: bigint;
  proof: `0x${string}`[];
  claimed: boolean;
  deadline: number; // unix seconds; 0 = none pinned
  expired: boolean; // past the claim window (may already be swept)
}

const A = STAKING_ADDRESSES;

/** Read every season this wallet has a claimable (or claimed) entry for. Empty
 *  when the distributor has no seasons yet, is unreachable, or no manifest is
 *  published — all normal pre-launch states, none of which should surface as an
 *  error on the page. */
async function readClaims(user: `0x${string}` | null): Promise<ClaimableSeason[]> {
  if (!user) return [];
  let count = 0;
  try {
    count = Number(
      await stakingClient.readContract({ address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "seasonCount" }),
    );
  } catch {
    return []; // distributor not deployed / RPC down — nothing to claim.
  }
  const out: ClaimableSeason[] = [];
  for (let id = 0; id < count; id++) {
    const manifest = await loadClaimManifest(id);
    const entry = manifest?.claims[user.toLowerCase()];
    if (!entry) continue;
    let amount: bigint;
    try { amount = BigInt(entry.amount); } catch { continue; }
    if (amount <= BigInt(0)) continue;
    const season = (await stakingClient.readContract({
      address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "seasons", args: [BigInt(id)],
    })) as readonly [`0x${string}`, bigint, bigint, bigint];
    const root = season[0];
    if (!root || root === ZERO_ROOT) continue; // season not open on-chain yet.
    // Trustless gate: the proof must fold to the ON-CHAIN root, not whatever the
    // manifest claims. A tampered amount/proof simply fails here and is skipped.
    if (!verifyProof(leafOf(BigInt(id), user, amount), entry.proof, root)) continue;
    const claimed = (await stakingClient.readContract({
      address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "hasClaimed", args: [BigInt(id), user],
    })) as boolean;
    const deadline = Number(season[3]);
    out.push({ seasonId: id, amount, proof: entry.proof, claimed, deadline, expired: deadline > 0 && Date.now() / 1000 > deadline });
  }
  return out;
}

/** Claims-only read for surfaces OUTSIDE the Staking page (the app-top season
 *  rewards banner). Shares the ["staking", "claims"] key with useStaking's own
 *  claims query — so a claim write's invalidation clears the banner too — but
 *  polls gently: claims change once per season, and a banner mounted on every
 *  screen must not drag the heavy snapshot polling along with it. */
export function useSeasonClaims(user: `0x${string}` | null): ClaimableSeason[] {
  const query = useQuery({
    queryKey: ["staking", "claims", user],
    queryFn: () => readClaims(user),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    enabled: !!user,
  });
  return query.data ?? [];
}

async function readSnapshot(user: `0x${string}` | null): Promise<StakingSnapshot> {
  // Fire every read in the same tick: stakingClient batches multicall, but only
  // calls issued together fold into one eth_call — awaiting the totals before
  // the user reads was silently paying two round trips per poll.
  const [[totalWeight, totalStaked, cooldown], userReads] = await Promise.all([
    Promise.all([
      stakingClient.readContract({ address: A.staking, abi: stakingAbi, functionName: "totalWeight" }),
      stakingClient.readContract({ address: A.staking, abi: stakingAbi, functionName: "totalStaked" }),
      stakingClient.readContract({ address: A.staking, abi: stakingAbi, functionName: "cooldown" }),
    ]),
    user
      ? Promise.all([
          stakingClient.readContract({ address: A.token, abi: stakingTokenAbi, functionName: "balanceOf", args: [user] }),
          stakingClient.readContract({ address: A.staking, abi: stakingAbi, functionName: "stakedOf", args: [user] }),
          stakingClient.readContract({ address: A.staking, abi: stakingAbi, functionName: "pendingOf", args: [user] }),
          stakingClient.readContract({ address: A.staking, abi: stakingAbi, functionName: "weightOf", args: [user] }),
        ])
      : null,
  ]);

  let wallet = BigInt(0), staked = BigInt(0), pending = BigInt(0), weight = BigInt(0);
  let unlockAt = 0;
  if (userReads) {
    const [w, s, p, wt] = userReads;
    wallet = w; staked = s; pending = p[0]; unlockAt = Number(p[1]); weight = wt;
  }

  // Leaderboard AND the reward preview both come from /api/staking/rewards.
  //
  // The browser deliberately does NOT scan for stakers itself. The public
  // Robinhood RPC caps eth_getLogs at ~2000 blocks and the contract sits ~900k
  // blocks back, so a client-side scan cannot succeed. It used to run here as
  // getLogs(0 -> latest), it failed on every load, and because it sat unguarded
  // in this function it rejected the WHOLE snapshot: balances went null, so the
  // panel showed "—" everywhere and the stake guard read the wallet as 0 and
  // refused every stake. A cosmetic table was blocking the primary action.
  //
  // Now the server does the scan once (chunked, cached in KV, shared) and this
  // is a single guarded fetch. If it fails, the leaderboard and reward tiles
  // degrade to "—" and everything that gates staking keeps working.
  let rows: StakerRow[] = [];
  let rewards: StakerRewards | undefined;
  if (user) {
    try {
      const res = await fetch(`/api/staking/rewards?address=${user}&all=1`, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as {
          seasonStarted?: boolean;
          bankedSoFar?: string;
          todayAccruing?: string;
          stakers?: { address: string; staked: string; earned: string }[];
        };
        if (j.seasonStarted && j.bankedSoFar !== undefined) {
          rewards = { bankedSoFar: BigInt(j.bankedSoFar), todayAccruing: BigInt(j.todayAccruing ?? "0") };
        }
        if (j.stakers) {
          rows = j.stakers.map((r) => ({
            address: r.address as `0x${string}`,
            staked: BigInt(r.staked),
            weight: BigInt(0),
            earned: BigInt(r.earned),
          }));
        }
      }
    } catch {
      /* leaderboard stays empty, balances above are unaffected */
    }
  }

  return {
    wallet, staked, pending, unlockAt, weight, totalWeight, totalStaked,
    cooldownSeconds: Number(cooldown),
    leaderboard: rows,
    rewards,
  };
}

export type StakingAction = "stake" | "unstake" | "cancel" | "withdraw" | "mint" | "claim";

export function useStaking(w: StakingWallet) {
  const qc = useQueryClient();
  const refreshBalances = useRefreshBalances();
  const user = w.address;
  const [busy, setBusy] = useState<StakingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);
  // What the flow is doing right now — surfaced in the UI so a wallet prompt
  // waiting off-screen never looks like a frozen button.
  const [step, setStep] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["staking", user],
    queryFn: () => readSnapshot(user),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  // Separate query (keyed under the same "staking" prefix so a stake/claim
  // invalidation refreshes it too): a manifest fetch failure must not blank the
  // main snapshot.
  const claimsQuery = useQuery({
    queryKey: ["staking", "claims", user],
    queryFn: () => readClaims(user),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!user,
  });

  const run = useCallback(
    async (action: StakingAction, fn: (wc: ReturnType<typeof createWalletClient>) => Promise<`0x${string}`>) => {
      if (!user || busy) return;
      setBusy(action);
      setError(null);
      const deadline = <T,>(p: Promise<T>, ms: number, what: string) =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
      try {
        setStep("Switching network…");
        const provider = await deadline(w.ensureChain(), 20_000, "Network switch");
        const wc = createWalletClient({ account: user, chain: stakingChain, transport: custom(provider) });
        setStep(w.silentSigning ? "Sending transaction…" : "Waiting for your wallet…");
        const hash = await deadline(fn(wc), 180_000, "Transaction");
        setLastTx(hash);
        setStep("Confirming on-chain…");
        await deadline(stakingClient.waitForTransactionReceipt({ hash }), 90_000, "Confirmation");
        await qc.invalidateQueries({ queryKey: ["staking"] });
        // Staked/unstaking $MONVERA also renders in the /api/portfolio surfaces
        // (holding rows, totals), so a staking write must refresh the money
        // queries too — same list + delayed second pass as every other
        // on-chain write, or the portfolio shows stale numbers until its poll.
        refreshBalances();
      } catch (e) {
        console.error(`[staking] ${action}`, e);
        setError(explainError(e));
      } finally {
        await w.restoreChain();
        setStep(null);
        setBusy(null);
      }
    },
    [user, busy, qc, w, refreshBalances],
  );

  const stake = useCallback(async (amount: string) => {
    const raw = parseUnits(amount, 18);
    await run("stake", async (wc) => {
      const allowance = await stakingClient.readContract({
        address: A.token, abi: stakingTokenAbi, functionName: "allowance",
        args: [user as `0x${string}`, A.staking],
      });
      if (allowance < raw) {
        const h = await wc.writeContract({
          address: A.token, abi: stakingTokenAbi, functionName: "approve",
          args: [A.staking, raw], chain: stakingChain, account: wc.account!,
        });
        await stakingClient.waitForTransactionReceipt({ hash: h });
      }
      return wc.writeContract({
        address: A.staking, abi: stakingAbi, functionName: "stake",
        args: [raw], chain: stakingChain, account: wc.account!,
      });
    });
  }, [run, user]);

  const requestUnstake = useCallback((amount: string) => run("unstake", (wc) =>
    wc.writeContract({
      address: A.staking, abi: stakingAbi, functionName: "requestUnstake",
      args: [parseUnits(amount, 18)], chain: stakingChain, account: wc.account!,
    })), [run]);

  const cancelUnstake = useCallback(() => run("cancel", (wc) =>
    wc.writeContract({
      address: A.staking, abi: stakingAbi, functionName: "cancelUnstake",
      chain: stakingChain, account: wc.account!,
    })), [run]);

  const withdraw = useCallback(() => run("withdraw", (wc) =>
    wc.writeContract({
      address: A.staking, abi: stakingAbi, functionName: "withdraw",
      chain: stakingChain, account: wc.account!,
    })), [run]);

  /** Testnet only: tMONVERA has an open mint — top yourself up to play. */
  const mintTest = useCallback(() => run("mint", (wc) =>
    wc.writeContract({
      address: A.token, abi: stakingTokenAbi, functionName: "mint",
      args: [user as `0x${string}`, parseUnits("500000", 18)], chain: stakingChain, account: wc.account!,
    })), [run, user]);

  /** Claim a closed season's banked reward. Anyone may submit for any account,
   *  but the tokens always go to `account` — so we submit for the connected
   *  wallet. The `run` invalidation refreshes the claims list on success. */
  const claim = useCallback((seasonId: number, amount: bigint, proof: `0x${string}`[]) =>
    run("claim", (wc) => wc.writeContract({
      address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "claim",
      args: [BigInt(seasonId), user as `0x${string}`, amount, proof], chain: stakingChain, account: wc.account!,
    })), [run, user]);

  return {
    address: user,
    snapshot: query.data ?? null,
    claims: claimsQuery.data ?? [],
    loading: query.isLoading,
    busy,
    step,
    error,
    lastTx,
    clearError: () => setError(null),
    stake, requestUnstake, cancelUnstake, withdraw, mintTest, claim,
  };
}
