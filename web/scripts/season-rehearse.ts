// TESTNET CLAIM REHEARSAL — not for mainnet.
//
// Opens a real Season on the TESTNET SeasonDistributor, crediting the current
// on-chain stakers a small test pool split by their live stake-time weight, then
// writes the claim manifest the UI reads. Lets the claim flow be exercised end to
// end (manifest -> on-chain-root proof check -> claim() -> tokens move) without
// waiting out a 90-day season. Signs with the deployer key in contracts/.env,
// which owns the testnet distributor.
//
//   npx tsx scripts/season-rehearse.ts [poolTokens=10000]
import { config as dotenv } from "dotenv";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stakingChain, STAKING_ADDRESSES, stakingAbi, stakingTokenAbi } from "../src/lib/staking";
import { leafOf, buildLayers, rootOf, proofFor, verifyProof } from "../src/lib/season/compute";

dotenv({ path: join(process.cwd(), "..", "contracts", ".env") });
const PK = (process.env.PRIVATE_KEY ?? "").trim().split(/\s+/)[0];
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) throw new Error("PRIVATE_KEY not found in ../contracts/.env");

const A = STAKING_ADDRESSES;
const openAbi = parseAbi(["function openSeason(bytes32 root, uint256 pool, uint64 claimDeadline) returns (uint256)"]);
const countAbi = parseAbi(["function seasonCount() view returns (uint256)"]);
const fmt = (w: bigint) => Number(formatUnits(w, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });

async function main() {
  const account = privateKeyToAccount(PK as `0x${string}`);
  const pub = createPublicClient({ chain: stakingChain, transport: http(stakingChain.rpcUrls.default.http[0]) });
  const wc = createWalletClient({ account, chain: stakingChain, transport: http(stakingChain.rpcUrls.default.http[0]) });
  console.log(`deployer/owner ${account.address}`);

  const seasonId = Number(await pub.readContract({ address: A.seasonDistributor, abi: countAbi, functionName: "seasonCount" }));
  console.log(`opening season ${seasonId} on ${A.seasonDistributor}`);

  // ── current stakers + live weight ────────────────────────────────────────────
  const head = await pub.getBlockNumber();
  const stakedEvent = parseAbiItem("event Staked(address indexed user, uint256 amount, uint256 stakedAfter)");
  const logs = await pub.getLogs({ address: A.staking, event: stakedEvent, fromBlock: BigInt(0), toBlock: head });
  const users = [...new Set(logs.map((l) => l.args.user).filter(Boolean))] as `0x${string}`[];
  const weights = await Promise.all(users.map((u) => pub.readContract({ address: A.staking, abi: stakingAbi, functionName: "weightOf", args: [u] })));
  const totalW = weights.reduce((s, w) => s + w, BigInt(0));
  if (totalW === BigInt(0)) throw new Error("no stake-time weight on-chain yet — stake something first.");

  // ── split a small test pool by weight, floor, remainder to the last entry ─────
  const pool = parseUnits(process.argv[2] ?? "10000", 18);
  const sorted = users
    .map((account, i) => ({ account, weight: weights[i] }))
    .sort((a, b) => (a.account.toLowerCase() < b.account.toLowerCase() ? -1 : 1));
  const entries = sorted.map((e) => ({ account: e.account, amount: (pool * e.weight) / totalW }));
  const dust = pool - entries.reduce((s, e) => s + e.amount, BigInt(0));
  entries[entries.length - 1].amount += dust; // keep sum(amounts) == pool exactly
  const claimable = entries.filter((e) => e.amount > BigInt(0));

  // ── merkle (identical primitives to the on-chain verify) ─────────────────────
  const leaves = claimable.map((e) => leafOf(BigInt(seasonId), e.account, e.amount));
  const layers = buildLayers(leaves);
  const root = rootOf(layers);
  const proofs: Record<string, `0x${string}`[]> = {};
  claimable.forEach((e, i) => {
    const proof = proofFor(layers, i);
    if (!verifyProof(leaves[i], proof, root)) throw new Error(`proof self-check failed for ${e.account}`);
    proofs[e.account.toLowerCase()] = proof;
  });

  console.log(`\npool ${fmt(pool)} tMONVERA over ${claimable.length} stakers:`);
  for (const e of claimable) console.log(`  ${e.account}  ${fmt(e.amount)}`);
  console.log(`root ${root}`);

  // ── write the claim manifest the UI reads ────────────────────────────────────
  const nowTs = (await pub.getBlock({ blockNumber: head })).timestamp;
  const deadline = nowTs + BigInt(31) * BigInt(86400); // >= 30d min enforced on-chain
  const manifest = {
    seasonId, root, pool: pool.toString(), token: A.token,
    claimDeadline: Number(deadline), generatedAtBlock: head.toString(),
    claims: Object.fromEntries(claimable.map((e) => [e.account.toLowerCase(), { amount: e.amount.toString(), proof: proofs[e.account.toLowerCase()] }])),
  };
  const dir = join(process.cwd(), "public", "seasons");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `season-${seasonId}.json`), JSON.stringify(manifest, null, 2));
  console.log(`\nwrote public/seasons/season-${seasonId}.json`);

  // ── fund + open on-chain ─────────────────────────────────────────────────────
  const bal = await pub.readContract({ address: A.token, abi: stakingTokenAbi, functionName: "balanceOf", args: [account.address] });
  if (bal < pool) {
    console.log(`minting ${fmt(pool)} tMONVERA (open testnet mint)…`);
    await pub.waitForTransactionReceipt({ hash: await wc.writeContract({ address: A.token, abi: stakingTokenAbi, functionName: "mint", args: [account.address, pool], chain: stakingChain, account }) });
  }
  const allow = await pub.readContract({ address: A.token, abi: stakingTokenAbi, functionName: "allowance", args: [account.address, A.seasonDistributor] });
  if (allow < pool) {
    console.log(`approving distributor for ${fmt(pool)}…`);
    await pub.waitForTransactionReceipt({ hash: await wc.writeContract({ address: A.token, abi: stakingTokenAbi, functionName: "approve", args: [A.seasonDistributor, pool], chain: stakingChain, account }) });
  }
  console.log(`openSeason(root, pool, deadline)…`);
  const hash = await wc.writeContract({ address: A.seasonDistributor, abi: openAbi, functionName: "openSeason", args: [root, pool, deadline], chain: stakingChain, account });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`\nopened. tx ${hash}`);
  console.log(`\nNow connect one of the credited wallets in /stake and click Claim.`);
}

main().catch((e) => { console.error("REHEARSE FATAL:", e.shortMessage ?? e.message ?? e); process.exit(1); });
