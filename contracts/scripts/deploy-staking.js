const hre = require("hardhat");
const { defineChain, formatEther, isAddress, getAddress } = require("viem");

// viem has no built-in entry for Robinhood Chain — define it for the clients.
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

// Deploys the FULL staking stack on Robinhood Chain (4663):
//   MonveraStaking        zero-admin, immutable 14-day cooldown — holds staked $MONVERA
//   GroveCuratorRegistry  Ownable2Step, gates curator assignment (holds no funds)
//   SeasonDistributor     Ownable2Step, holds the season reward pool, merkle claims
//
// Ownership hygiene (audit HIGH): MonveraStaking has NO owner by design. The two
// Ownable2Step contracts must NOT rest on the hot deployer key — this script
// transfers their ownership to OWNER_ADDRESS (a dedicated COLD key). Ownable2Step
// is two-step: this sets pendingOwner; the cold key must then call acceptOwnership.
//
// Requires in contracts/.env:
//   PRIVATE_KEY    deployer (pays gas; must NOT be the resting owner)
//   OWNER_ADDRESS  the cold EOA that will own the registry + distributor
// Run: OWNER_ADDRESS=0x... npx hardhat run scripts/deploy-staking.js --network robinhood

const MONVERA = "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF"; // 18dp, on 4663
const COOLDOWN_SECONDS = 14 * 24 * 3600; // 14 days — immutable at deploy (owner-confirmed 2026-07-24)
// Curator gate (settable later on the registry): 500k $MONVERA staked.
const MIN_CURATOR_STAKE = 500_000n * 10n ** 18n;

const decimalsAbi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }];

async function main() {
  // ── preflight: chain, owner, gas, token sanity ───────────────────────────────
  if (hre.network.config.chainId !== 4663) {
    throw new Error(`wrong network: chainId ${hre.network.config.chainId} — run with --network robinhood (4663).`);
  }
  const ownerEnv = (process.env.OWNER_ADDRESS ?? "").trim().split(/\s+/)[0];
  if (!isAddress(ownerEnv)) {
    throw new Error("set OWNER_ADDRESS to the cold EOA that will own the registry + distributor (a checksummed 0x address).");
  }
  const OWNER = getAddress(ownerEnv);

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  const clients = { client: { public: publicClient, wallet: deployer } };
  const me = getAddress(deployer.account.address);
  const bal = await publicClient.getBalance({ address: me });

  if (OWNER.toLowerCase() === me.toLowerCase()) {
    throw new Error("OWNER_ADDRESS must NOT equal the deployer key — the whole point is that a hot key never rests as owner.");
  }

  console.log(`Network:  ${hre.network.name} (chainId ${hre.network.config.chainId})`);
  console.log(`Deployer: ${me}  (${formatEther(bal)} ETH)`);
  console.log(`Owner→:   ${OWNER}  (cold key; will own registry + distributor)`);
  console.log(`MONVERA:  ${MONVERA}`);
  console.log(`Cooldown: ${COOLDOWN_SECONDS}s (14 days, immutable)\n`);

  if (bal === 0n) throw new Error("deployer has 0 ETH for gas.");

  // Token sanity: a valid-but-wrong address would permanently brick staking
  // (token is immutable). Reading decimals() reverts on a non-token, aborting here.
  let dec;
  try {
    dec = await publicClient.readContract({ address: MONVERA, abi: decimalsAbi, functionName: "decimals" });
  } catch (e) {
    throw new Error(`MONVERA ${MONVERA} does not respond to decimals() — not an ERC-20? Aborting. (${e.shortMessage ?? e.message})`);
  }
  if (Number(dec) !== 18) throw new Error(`MONVERA decimals() = ${dec}, expected 18. Wrong token address? Aborting.`);
  console.log(`token check: decimals() = 18 OK\n`);

  // ── deploy ───────────────────────────────────────────────────────────────────
  const staking = await hre.viem.deployContract("MonveraStaking", [MONVERA, BigInt(COOLDOWN_SECONDS)], clients);
  console.log(`MonveraStaking:       ${staking.address}   (ownerless — no admin)`);

  const registry = await hre.viem.deployContract("GroveCuratorRegistry", [staking.address, MIN_CURATOR_STAKE], clients);
  console.log(`GroveCuratorRegistry: ${registry.address}   (owner = deployer, transferring…)`);

  const dist = await hre.viem.deployContract("SeasonDistributor", [MONVERA], clients);
  console.log(`SeasonDistributor:    ${dist.address}   (owner = deployer, transferring…)\n`);

  // ── hand both Ownable2Step contracts to the cold key (sets pendingOwner) ──────
  await publicClient.waitForTransactionReceipt({
    hash: await registry.write.transferOwnership([OWNER], { account: deployer.account }),
  });
  console.log(`registry.transferOwnership(${OWNER})   → pendingOwner set`);
  await publicClient.waitForTransactionReceipt({
    hash: await dist.write.transferOwnership([OWNER], { account: deployer.account }),
  });
  console.log(`distributor.transferOwnership(${OWNER}) → pendingOwner set\n`);

  // ── next steps ────────────────────────────────────────────────────────────────
  console.log(`ACTION REQUIRED — from the COLD key (${OWNER}), accept ownership of BOTH:`);
  console.log(`  registry.acceptOwnership()      @ ${registry.address}`);
  console.log(`  distributor.acceptOwnership()   @ ${dist.address}`);
  console.log(`  Until accepted, the deployer is still owner (Ownable2Step).\n`);

  console.log(`Verify on Blockscout:`);
  console.log(`  npx hardhat verify --network robinhood ${staking.address} ${MONVERA} ${COOLDOWN_SECONDS}`);
  console.log(`  npx hardhat verify --network robinhood ${registry.address} ${staking.address} ${MIN_CURATOR_STAKE}`);
  console.log(`  npx hardhat verify --network robinhood ${dist.address} ${MONVERA}\n`);

  const deployBlock = await publicClient.getBlockNumber();
  console.log(`Wire the web app (src/lib/staking.ts) — set STAKING_TESTNET=false and:`);
  console.log(`  token:             "${MONVERA.toLowerCase()}"`);
  console.log(`  staking:           "${staking.address.toLowerCase()}"`);
  console.log(`  curatorRegistry:   "${registry.address.toLowerCase()}"`);
  console.log(`  seasonDistributor: "${dist.address.toLowerCase()}"`);
  console.log(`And for the season builder: SEASON_DEPLOY_BLOCK=${deployBlock}  (set SEASON_START at launch)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
