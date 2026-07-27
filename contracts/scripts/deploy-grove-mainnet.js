const hre = require("hardhat");
const { defineChain } = require("viem");

// GroveManager day-0 deploy on Robinhood Chain 4663.
//
// Deploys, wires the roles, creates the ONE launch grove, and QUEUES everything
// that is timelocked. It deliberately does NOT trade: swap-target additions wait
// 48h by design, so the first real buy is two days after this runs. Re-run
// scripts/grove-apply.js once the timelock matures.
//
// Verified on-chain before this was written (do not take on faith, re-check if
// it has been a while):
//   - all 7 feeds answer, 18dp token / 8dp feed => scalePow 20
//   - UniversalRouter, Permit2 and Kyber's MetaAggregationRouterV2 all have code
//   - treasury is an EOA, which is right: it only ever receives.
//
// Run: npx hardhat run scripts/deploy-grove-mainnet.js --network robinhood

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // 6dp
const TREASURY = "0xb87f5A74267ca3F9512b8511B32cCd804EA3707E"; // IMMUTABLE at deploy

// Venues. Kyber needs the SAME address in both roles — that is its whole
// integration, because GroveManager is router-agnostic by construction.
const VENUES = [
  { addr: "0x8876789976dEcBfCbBbe364623C63652db8C0904", asApproval: false, label: "UniversalRouter (call)" },
  { addr: "0x000000000022D473030F116dDEE9F6B43aC78BA3", asApproval: true, label: "Permit2 (approve)" },
  { addr: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", asApproval: false, label: "Kyber MetaAggregationRouterV2 (call)" },
  { addr: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", asApproval: true, label: "Kyber MetaAggregationRouterV2 (approve)" },
];
// LiFi is deliberately absent: its approvalAddress can differ per quote, so it
// must be pinned from a live 4663 quote before being proposed. Adding it later
// is just another 48h proposal.

// heartbeat = 7200s (2h). Measured 2026-07-26: observed feed ages ran 36-89 min,
// so the spec's 3600 default would have marked AMZN and META stale on day one —
// silently demoting them to the wide band and locking the manager out of them.
// Erring long is the DANGEROUS direction (the manager could trade a stale price)
// and erring short is merely conservative, so 7200 is deliberately only ~35%
// above the observed maximum. Re-sample during a full US session and tighten.
const HEARTBEAT = 7200;

const BASKET = [
  { sym: "AAPL", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", weightBps: 1500 },
  { sym: "MSFT", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", weightBps: 1500 },
  { sym: "NVDA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", weightBps: 1500 },
  { sym: "GOOGL", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", weightBps: 1500 },
  { sym: "AMZN", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", weightBps: 1400 },
  { sym: "META", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", weightBps: 1300 },
  { sym: "TSLA", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38", weightBps: 1300 },
];

const GROVE_NAME = "Blue Chips";
const GROVE_FEE_BPS = 1000; // 10% of PROFIT at exit. IMMUTABLE — there is no setter.

async function main() {
  const sum = BASKET.reduce((a, c) => a + c.weightBps, 0);
  if (sum !== 10_000) throw new Error(`weights sum to ${sum}, not 10000`);

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  const mined = (hash) => publicClient.waitForTransactionReceipt({ hash });

  const bal = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`\nNetwork:  ${hre.network.name} (4663)`);
  console.log(`Deployer: ${deployer.account.address}`);
  console.log(`Balance:  ${Number(bal) / 1e18} ETH`);
  console.log(`USDG:     ${USDG}`);
  console.log(`Treasury: ${TREASURY}   <-- IMMUTABLE, no setter\n`);

  const startBlock = await publicClient.getBlockNumber();

  // ── deploy ────────────────────────────────────────────────────────────────
  const gm = await hre.viem.deployContract("GroveManager", [USDG, TREASURY], {
    client: { public: publicClient, wallet: deployer },
  });
  console.log(`GroveManager deployed: ${gm.address}`);
  console.log(`  deploy block:       ${startBlock}`);

  // Read the immutables back. A wrong treasury is unfixable.
  const [onUsdg, onTreasury, band, staleBand] = await Promise.all([
    gm.read.usdg(),
    gm.read.treasury(),
    gm.read.bandBps(),
    gm.read.staleBandBps(),
  ]);
  console.log(`  usdg (readback):    ${onUsdg}`);
  console.log(`  treasury (readback):${onTreasury}`);
  console.log(`  bandBps:            ${band}   staleBandBps: ${staleBand}`);
  if (onUsdg.toLowerCase() !== USDG.toLowerCase()) throw new Error("USDG mismatch — ABORT");
  if (onTreasury.toLowerCase() !== TREASURY.toLowerCase()) throw new Error("treasury mismatch — ABORT");

  // ── roles ─────────────────────────────────────────────────────────────────
  const managerKey = (process.env.GROVE_MANAGER_KEY || "").trim().split(/\s+/)[0];
  const guardianKey = (process.env.GROVE_GUARDIAN || "").trim().split(/\s+/)[0];
  console.log("");
  if (managerKey) {
    await mined(await gm.write.setManager([managerKey]));
    console.log(`Manager:  ${managerKey}`);
  } else {
    console.log(`Manager:  UNSET — auto-manage is inert until setManager (instant, any time).`);
  }
  if (guardianKey) {
    await mined(await gm.write.setGuardian([guardianKey]));
    console.log(`Guardian: ${guardianKey}`);
  } else {
    console.log(`Guardian: UNSET — nobody can pause until setGuardian (instant, any time).`);
    console.log(`          Use a DIFFERENT key from the owner: the owner cannot pause directly.`);
  }

  // ── the one grove (no timelock on version 1) ─────────────────────────────
  console.log(`\nCreating grove "${GROVE_NAME}" (feeBps ${GROVE_FEE_BPS} = 10% of profit, IMMUTABLE)`);
  await mined(
    await gm.write.createGrove([
      GROVE_NAME,
      GROVE_FEE_BPS,
      BASKET.map((c) => ({ token: c.token, weightBps: c.weightBps })),
    ]),
  );
  const g = await gm.read.groves([0n]);
  console.log(`  grove 0: "${g[0]}"  feeBps=${g[1]}  version=${g[2]}`);
  for (const c of BASKET) console.log(`    ${c.sym.padEnd(6)} ${c.weightBps / 100}%  ${c.token}`);

  // ── queue the 48h wiring ─────────────────────────────────────────────────
  console.log(`\nQueueing swap targets (48h timelock)`);
  for (const v of VENUES) {
    await mined(await gm.write.proposeSwapTarget([v.addr, v.asApproval]));
    console.log(`  ${v.label}`);
  }

  console.log(`\nQueueing feeds (48h timelock, heartbeat ${HEARTBEAT}s)`);
  for (const c of BASKET) {
    await mined(await gm.write.proposeFeed([c.token, c.feed, HEARTBEAT]));
    console.log(`  ${c.sym.padEnd(6)} -> ${c.feed}`);
  }

  const after = await publicClient.getBalance({ address: deployer.account.address });
  const eta = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  console.log(`\nSpent: ${(Number(bal - after) / 1e18).toFixed(8)} ETH   Remaining: ${(Number(after) / 1e18).toFixed(8)} ETH`);
  console.log(`\nDAY 0 COMPLETE. Timelock matures ~${eta}`);
  console.log(`Nothing can trade until then — that is the design, not a bug.`);
  console.log(`\nNext:`);
  console.log(`  1. npx hardhat run scripts/grove-apply.js --network robinhood   (after ${eta})`);
  console.log(`  2. set NEXT_PUBLIC_GROVE_MANAGER=${gm.address} in web/.env.local`);
  console.log(`  3. verify: npx hardhat verify --network robinhood ${gm.address} ${USDG} ${TREASURY}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
