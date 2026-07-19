const hre = require("hardhat");
const { defineChain } = require("viem");

// viem has no built-in entry for X Layer — define it for the clients.
const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC_URL || "https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/x-layer" } },
});

// Deploys VeraRecordV2 on X Layer (196) for the OKX.AI ASP listing.
// The V2 signature binds payer/usdSpent/legCount — closing the V1 forgery gap.
//
// Requires in contracts/.env:
//   PRIVATE_KEY               — deployer, funded with a little OKB on X Layer
//   VERA_OKX_AGENT_SIGNER     — the vera-okx worker's AGENT_SIGNER address
//
// Run: npx hardhat run scripts/deploy-verarecord2-xlayer.js --network xlayer

async function main() {
  const agentSigner = (process.env.VERA_OKX_AGENT_SIGNER || "").trim().split(/\s+/)[0];
  if (!agentSigner) throw new Error("VERA_OKX_AGENT_SIGNER not set in contracts/.env");

  const publicClient = await hre.viem.getPublicClient({ chain: xlayer });
  const [deployer] = await hre.viem.getWalletClients({ chain: xlayer });
  console.log(`Network:      ${hre.network.name}`);
  console.log(`Deployer:     ${deployer.account.address}`);
  console.log(`Agent signer: ${agentSigner}`);
  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`OKB balance:  ${Number(balance) / 1e18}\n`);
  if (balance === 0n) throw new Error("Deployer has no OKB on X Layer — fund it first.");

  const startBlock = await publicClient.getBlockNumber();
  const clientPair = { client: { public: publicClient, wallet: deployer } };
  const record = await hre.viem.deployContract("VeraRecordV2", [agentSigner], clientPair);
  console.log(`VeraRecordV2: ${record.address}`);
  console.log(`Start block:  ${startBlock}\n`);

  console.log("=== Set on the vera-okx worker (wrangler.jsonc vars) ===");
  console.log(`VERA_RECORD_V2_ADDRESS=${record.address}`);
  console.log(`Explorer: https://www.oklink.com/x-layer/address/${record.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
