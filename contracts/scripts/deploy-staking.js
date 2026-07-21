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

// Deploys MonveraStaking (zero-admin, immutable cooldown) and
// GroveCuratorRegistry (the public curator-terms commitment) on Robinhood
// Chain (4663).
//
// Staking holds rights, not rates: no reward math on-chain, no owner, no
// pause — unstake (7-day cooldown) can never be blocked. The registry gates
// curator assignment on live staked balance and caps the fee share at 50%.
//
// Requires in contracts/.env: PRIVATE_KEY (deployer; becomes registry owner).
// Run: npx hardhat run scripts/deploy-staking.js --network robinhood

const MONVERA = "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF"; // 18dp, on 4663
const COOLDOWN_SECONDS = 7 * 24 * 3600; // 7 days — immutable at deploy
// Curator gate (settable later on the registry): 500k $MONVERA staked.
const MIN_CURATOR_STAKE = 500_000n * 10n ** 18n;

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  console.log(`Network:  ${hre.network.name}`);
  console.log(`Deployer: ${deployer.account.address}`);
  console.log(`MONVERA:  ${MONVERA}`);
  console.log(`Cooldown: ${COOLDOWN_SECONDS}s (7 days)\n`);

  const staking = await hre.viem.deployContract("MonveraStaking", [MONVERA, BigInt(COOLDOWN_SECONDS)], {
    client: { public: publicClient, wallet: deployer },
  });
  console.log(`MonveraStaking:      ${staking.address}`);

  const registry = await hre.viem.deployContract("GroveCuratorRegistry", [staking.address, MIN_CURATOR_STAKE], {
    client: { public: publicClient, wallet: deployer },
  });
  console.log(`GroveCuratorRegistry: ${registry.address}`);

  console.log(`\nVerify on Blockscout:`);
  console.log(
    `  npx hardhat verify --network robinhood ${staking.address} ${MONVERA} ${COOLDOWN_SECONDS}`,
  );
  console.log(
    `  npx hardhat verify --network robinhood ${registry.address} ${staking.address} ${MIN_CURATOR_STAKE}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
