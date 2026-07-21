const hre = require("hardhat");
const { defineChain, formatEther } = require("viem");

const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com"] },
  },
});

// Deploys the FULL staking stack on Robinhood Chain TESTNET (46630) with a
// mintable test token standing in for $MONVERA, then runs a live smoke test:
// mint -> approve -> stake -> weight accrues -> requestUnstake -> pending.
//
//   tMONVERA        MockERC20 (open mint — it's a test token, mint freely)
//   MonveraStaking  1h cooldown (contract minimum; mainnet will use 7d)
//   GroveCuratorRegistry  gate 500k staked
//   SeasonDistributor     season claims (merkle)
//
// Run: npx hardhat run scripts/deploy-staking-testnet.js --network robinhoodTestnet

const COOLDOWN = 3600; // 1 hour — testnet only; mainnet: 7 days
const CURATOR_GATE = 500_000n * 10n ** 18n;
const M = (n) => BigInt(n) * 10n ** 18n;

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhoodTestnet });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhoodTestnet });
  const clients = { client: { public: publicClient, wallet: deployer } };
  const me = deployer.account.address;
  const bal = await publicClient.getBalance({ address: me });
  console.log(`Network:  robinhoodTestnet (46630)`);
  console.log(`Deployer: ${me}  (${formatEther(bal)} ETH)\n`);

  const token = await hre.viem.deployContract("MockERC20", ["Monvera Test", "tMONVERA", 18], clients);
  console.log(`tMONVERA:             ${token.address}`);

  const staking = await hre.viem.deployContract("MonveraStaking", [token.address, BigInt(COOLDOWN)], clients);
  console.log(`MonveraStaking:       ${staking.address}`);

  const registry = await hre.viem.deployContract("GroveCuratorRegistry", [staking.address, CURATOR_GATE], clients);
  console.log(`GroveCuratorRegistry: ${registry.address}`);

  const dist = await hre.viem.deployContract("SeasonDistributor", [token.address], clients);
  console.log(`SeasonDistributor:    ${dist.address}\n`);

  // ---- live smoke test ----
  console.log(`smoke: mint 10,000,000 tMONVERA to deployer...`);
  await (async (h) => publicClient.waitForTransactionReceipt({ hash: h }))(
    await token.write.mint([me, M(10_000_000)], clients.client ? { account: deployer.account } : {}),
  );
  console.log(`smoke: approve + stake 600,000...`);
  await publicClient.waitForTransactionReceipt({
    hash: await token.write.approve([staking.address, M(10_000_000)], { account: deployer.account }),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await staking.write.stake([M(600_000)], { account: deployer.account }),
  });
  const staked = await staking.read.stakedOf([me]);
  const eligible = await registry.read.curatorEligible([me]);
  console.log(`smoke: stakedOf = ${staked / 10n ** 18n} tMONVERA, curatorEligible = ${eligible}`);

  console.log(`smoke: requestUnstake 100,000...`);
  await publicClient.waitForTransactionReceipt({
    hash: await staking.write.requestUnstake([M(100_000)], { account: deployer.account }),
  });
  const [pending, unlockAt] = await staking.read.pendingOf([me]);
  const w = await staking.read.weightOf([me]);
  const tw = await staking.read.totalWeight();
  console.log(`smoke: pending = ${pending / 10n ** 18n} (unlocks ${new Date(Number(unlockAt) * 1000).toISOString()})`);
  console.log(`smoke: weightOf = ${w} token-seconds, totalWeight = ${tw}`);
  console.log(`\nAll addresses above — record them in tasks/todo.md + web testnet config.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
