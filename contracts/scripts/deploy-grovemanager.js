const hre = require("hardhat");
const { defineChain } = require("viem");

// viem has no built-in entry for Robinhood Chain — define it for the clients.
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

// Deploys GroveManager — the mandatory rail for Groves (curated stock baskets)
// on Robinhood Chain (4663), then wires the operational roles and QUEUES the
// swap-target whitelist (48h timelock; run the printed apply commands after it
// matures). Groves themselves are created afterwards by the owner.
//
// Requires in contracts/.env: PRIVATE_KEY (deployer = owner). Optional:
// GROVE_MANAGER_KEY (Vera ops key for auto-manage), GROVE_GUARDIAN (pause key).
//
// Run: npx hardhat run scripts/deploy-grovemanager.js --network robinhood

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // 6dp
const TREASURY = "0xb87f5A74267ca3F9512b8511B32cCd804EA3707E"; // buyback treasury
// Venues verified contract-callable on 4663. LiFi's approvalAddress can differ
// from its call target per-quote, so both roles get queued for the diamond.
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

async function main() {
  const managerKey = (process.env.GROVE_MANAGER_KEY || "").trim().split(/\s+/)[0];
  const guardianKey = (process.env.GROVE_GUARDIAN || "").trim().split(/\s+/)[0];

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  console.log(`Network:  ${hre.network.name}`);
  console.log(`Deployer: ${deployer.account.address}`);
  console.log(`USDG:     ${USDG}`);
  console.log(`Treasury: ${TREASURY}\n`);

  // Scan floor for the web readers — captured BEFORE the deploy.
  const startBlock = await publicClient.getBlockNumber();

  const clientPair = { client: { public: publicClient, wallet: deployer } };
  const gm = await hre.viem.deployContract("GroveManager", [USDG, TREASURY], clientPair);
  console.log(`GroveManager: ${gm.address}`);

  if (managerKey) {
    await publicClient.waitForTransactionReceipt({ hash: await gm.write.setManager([managerKey]) });
    console.log(`Manager set:  ${managerKey}`);
  }
  if (guardianKey) {
    await publicClient.waitForTransactionReceipt({ hash: await gm.write.setGuardian([guardianKey]) });
    console.log(`Guardian set: ${guardianKey}`);
  }

  // Queue the venue whitelist (adds are 48h-timelocked; removal is instant).
  // UniversalRouter is the call target; Permit2 is its approval spender.
  const proposals = [
    { target: UNIVERSAL_ROUTER, asApproval: false, label: "UniversalRouter (call)" },
    { target: PERMIT2, asApproval: true, label: "Permit2 (approval)" },
  ];
  for (const p of proposals) {
    await publicClient.waitForTransactionReceipt({
      hash: await gm.write.proposeSwapTarget([p.target, p.asApproval]),
    });
    console.log(`Queued ${p.label}: ${p.target}`);
  }
  console.log(
    `\nAfter 48h, apply each with:\n` +
      proposals
        .map((p) => `  gm.applySwapTarget("${p.target}", ${p.asApproval}) // ${p.label}`)
        .join("\n")
  );
  console.log(
    `\nLiFi Diamond addresses are dynamic per-quote — propose the diamond's call\n` +
      `target AND approvalAddress separately once pinned from a live quote.`
  );

  console.log("\n=== Copy into web/.env.local ===");
  console.log(`NEXT_PUBLIC_GROVE_MANAGER=${gm.address}`);
  console.log(`NEXT_PUBLIC_GROVE_MANAGER_BLOCK=${startBlock}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
