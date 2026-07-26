// Season root builder + on-chain reconciliation. Run with tsx.
//
//   SEASON_START=<utc-sec> SEASON_DEPLOY_BLOCK=<n> npx tsx scripts/season-build.ts [endBlock]
//
// Fetches the staking event stream, computes the daily-bucket season, reconciles
// the replayed balances against the contract's own weightOf/totalWeight views at
// the snapshot block (a hard gate against a silently-truncated getLogs), builds
// the merkle root, and proves every leaf verifies locally. Prints the openSeason
// calldata but NEVER opens anything — that stays a deliberate human step.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, http, formatUnits } from "viem";
import { stakingChain, stakingAbi, STAKING_ADDRESSES } from "../src/lib/staking";
import { fetchStakeEvents } from "../src/lib/season/fetch";
import { SEASON1, DEPLOY_BLOCK, STAKING } from "../src/lib/season/config";
import { buildSeason, previewFor, leafOf, verifyProof, replayBalances, weightUpTo, SECONDS_PER_DAY } from "../src/lib/season/compute";

const fmt = (w: bigint) => Number(formatUnits(w, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });

async function main() {
  if (SEASON1.seasonStart === BigInt(0)) throw new Error("Set SEASON_START (utc unix seconds of day-0 00:00) before building.");
  const client = createPublicClient({ chain: stakingChain, transport: http(stakingChain.rpcUrls.default.http[0]) });

  const argBlock = process.argv[2];
  const endBlock = argBlock ? BigInt(argBlock) : await client.getBlockNumber();
  const endTs = (await client.getBlock({ blockNumber: endBlock })).timestamp;
  console.log(`[season] scanning ${DEPLOY_BLOCK}..${endBlock} on ${stakingChain.name}`);

  // Finality: a root computed over a reorg-eligible head is not reproducible.
  // Read the chain's finalized head; a FINAL build (below) refuses to emit
  // openSeason calldata unless endBlock is at or below it.
  let finalizedBlock: bigint | null = null;
  try {
    finalizedBlock = (await client.getBlock({ blockTag: "finalized" })).number;
  } catch {
    finalizedBlock = null; // chain/RPC without a finalized tag — handled at the FINAL gate.
  }

  const events = await fetchStakeEvents(client, STAKING, DEPLOY_BLOCK, endBlock);
  console.log(`[season] ${events.length} events`);

  // ── on-chain reconciliation gate ────────────────────────────────────────────
  // A truncated getLogs would silently under-pay against an immutable root. Two
  // independent checks close that gap:
  //   (1) BALANCE: replayed staked balance == stakedOf(w) for every seen wallet,
  //       and Σ == totalStaked(). Catches dropped events for still-present wallets.
  //   (2) WEIGHT:  replayed token-seconds == weightOf(w) for every seen wallet,
  //       and Σ == totalWeight(). This is the crucial one — totalWeight() is the
  //       chain's global accumulator over EVERYONE, so a wallet whose entire event
  //       history was dropped (and has since fully exited to a 0 balance, invisible
  //       to the stakedOf sum) still shows up as a totalWeight shortfall here.
  const timelines = replayBalances(events);
  const wallets = [...timelines.keys()] as `0x${string}`[];
  let sumReplayed = BigInt(0), sumReplayedWeight = BigInt(0), bad = 0, badW = 0;
  for (const w of wallets) {
    const tl = timelines.get(w.toLowerCase())!;
    const replayed = tl.length ? tl[tl.length - 1].bal : BigInt(0);
    const replayedWeight = weightUpTo(tl, endTs);
    sumReplayed += replayed;
    sumReplayedWeight += replayedWeight;
    const onchain = await client.readContract({ address: STAKING_ADDRESSES.staking, abi: stakingAbi, functionName: "stakedOf", args: [w], blockNumber: endBlock });
    if (onchain !== replayed) { console.error(`  BAL  MISMATCH ${w}: replay ${fmt(replayed)} vs chain ${fmt(onchain)}`); bad++; }
    const onchainWeight = await client.readContract({ address: STAKING_ADDRESSES.staking, abi: stakingAbi, functionName: "weightOf", args: [w], blockNumber: endBlock });
    if (onchainWeight !== replayedWeight) { console.error(`  WGT  MISMATCH ${w}: replay ${replayedWeight} vs chain ${onchainWeight}`); badW++; }
  }
  const totalStaked = await client.readContract({ address: STAKING_ADDRESSES.staking, abi: stakingAbi, functionName: "totalStaked", blockNumber: endBlock });
  const totalWeight = await client.readContract({ address: STAKING_ADDRESSES.staking, abi: stakingAbi, functionName: "totalWeight", blockNumber: endBlock });
  if (bad > 0) throw new Error(`${bad} balance mismatches — refusing to build (likely truncated getLogs).`);
  if (badW > 0) throw new Error(`${badW} weight mismatches — refusing to build (likely truncated getLogs).`);
  if (sumReplayed !== totalStaked) throw new Error(`sum replayed ${sumReplayed} != totalStaked() ${totalStaked}`);
  if (sumReplayedWeight !== totalWeight) throw new Error(`sum replayed weight ${sumReplayedWeight} != totalWeight() ${totalWeight} — a wallet's events were dropped from the scan.`);
  console.log(`[season] reconciled ${wallets.length} wallets against chain: balances==stakedOf & Σ==totalStaked; token-seconds==weightOf & Σ==totalWeight OK`);

  // ── build + self-verify ─────────────────────────────────────────────────────
  const seasonEnd = SEASON1.seasonStart + BigInt(SEASON1.days) * SECONDS_PER_DAY;
  const finished = endTs >= seasonEnd;
  const res = buildSeason(events, SEASON1);
  for (const { account, amount } of res.leaves) {
    const ok = verifyProof(leafOf(SEASON1.seasonId, account, amount), res.proofs[account.toLowerCase()], res.root);
    if (!ok) throw new Error(`proof failed for ${account} — root would brick claims`);
  }

  console.log(`\n[season] season ${SEASON1.seasonId}  (${finished ? "FINAL" : "PREVIEW — season not over"})`);
  console.log(`  leaves        ${res.leaves.length}`);
  console.log(`  distributed   ${fmt(res.totalDistributed)} $MONVERA`);
  console.log(`  swept (floor dust) ${fmt(res.swept)} $MONVERA`);
  console.log(`  pool          ${fmt(SEASON1.pool)} $MONVERA`);
  console.log(`  root          ${res.root}`);
  console.log(`  all ${res.leaves.length} proofs verify locally: OK`);

  console.log(`\n  leaf table:`);
  for (const { account, amount } of res.leaves) console.log(`    ${account}  ${fmt(amount)}`);

  if (finished) {
    // Reproducibility gate: never emit openSeason calldata over a reorg-eligible head.
    if (finalizedBlock === null) {
      throw new Error("could not read a 'finalized' block tag from the RPC — pass an explicitly finalized endBlock as argv[2] and re-run before opening.");
    }
    if (endBlock > finalizedBlock) {
      throw new Error(`endBlock ${endBlock} is not finalized (finalized head ${finalizedBlock}); a reorg could change the root. Re-run with a finalized endBlock.`);
    }
    console.log(`  finality      endBlock ${endBlock} <= finalized ${finalizedBlock} OK`);
    console.log(`\n  openSeason(root, pool, claimDeadline) args:`);
    console.log(`    root         ${res.root}`);
    console.log(`    pool         ${SEASON1.pool.toString()}`);
    console.log(`    claimDeadline >= ${seasonEnd + BigInt(30) * SECONDS_PER_DAY} (seasonEnd + 30d)`);
    console.log(`  (transfer the pool to the opener first; do NOT open until this is reviewed.)`);

    // Publish the claim manifest the UI reads. Only a FINAL root is written —
    // the same amounts/proofs the on-chain root will verify. Host it at
    // /seasons/season-<id>.json (public/) or upload to R2 and point
    // NEXT_PUBLIC_CLAIM_BASE_URL at it.
    const manifest = {
      seasonId: Number(SEASON1.seasonId),
      root: res.root,
      pool: SEASON1.pool.toString(),
      token: STAKING_ADDRESSES.token,
      claimDeadline: Number(seasonEnd + BigInt(30) * SECONDS_PER_DAY), // suggested; on-chain value is authoritative
      generatedAtBlock: endBlock.toString(),
      claims: Object.fromEntries(
        res.leaves.map(({ account, amount }) => [
          account.toLowerCase(),
          { amount: amount.toString(), proof: res.proofs[account.toLowerCase()] },
        ]),
      ),
    };
    const dir = join(process.cwd(), "public", "seasons");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `season-${manifest.seasonId}.json`);
    await writeFile(file, JSON.stringify(manifest, null, 2));
    console.log(`\n  wrote claim manifest → public/seasons/season-${manifest.seasonId}.json (${res.leaves.length} claims)`);
  } else {
    // Show a couple of live previews to eyeball monotonicity.
    console.log(`\n  live preview (first 3 wallets):`);
    for (const w of wallets.slice(0, 3)) {
      const p = previewFor(events, SEASON1, endTs, w);
      console.log(`    ${w}  banked ${fmt(p.bankedSoFar)}  today ${fmt(p.todayAccruing)}`);
    }
  }
}

main().catch((e) => { console.error("[season] FATAL:", e.message ?? e); process.exit(1); });
