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

// Deploys Monvera's trust layer on Robinhood Chain (4663):
//   1. VeraRecord       — EIP-712 risk-inference verify + permanent record events
//                         (same event signatures the web readers already index).
//   2. IdentityRegistry — ERC-8004-style agent identity; registers Vera (agentId 1),
//                         owned by her signer, card at monvera.xyz.
//
// No executor and no router/asset whitelist: trading settles through Arcus RFQ
// signed by the user's EOA — funds never touch our contracts.
//
// Requires in contracts/.env: PRIVATE_KEY (deployer), MONVERA_AGENT_SIGNER
// (fresh Vera signer address for 4663).

const AGENT_CARD = "https://monvera.xyz/.well-known/agent-card.json";

async function main() {
  const agentSigner = (process.env.MONVERA_AGENT_SIGNER || "").trim().split(/\s+/)[0];
  if (!agentSigner) throw new Error("MONVERA_AGENT_SIGNER not set in contracts/.env");

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  console.log(`Network:      ${hre.network.name}`);
  console.log(`Deployer:     ${deployer.account.address}`);
  console.log(`Agent signer: ${agentSigner}\n`);

  // Scan floor for the web readers — captured BEFORE the first deploy.
  const startBlock = await publicClient.getBlockNumber();

  const clientPair = { client: { public: publicClient, wallet: deployer } };
  const record = await hre.viem.deployContract("VeraRecord", [agentSigner], clientPair);
  console.log(`VeraRecord:       ${record.address}`);

  const registry = await hre.viem.deployContract("IdentityRegistry", [], clientPair);
  console.log(`IdentityRegistry: ${registry.address}`);
  await publicClient.waitForTransactionReceipt({
    hash: await registry.write.register([agentSigner, AGENT_CARD]),
  });
  const agentId = (await registry.read.nextAgentId()) - 1n;
  console.log(`Vera registered -> agentId ${agentId} (owner = her signer)\n`);

  console.log("=== Copy into web/.env.local ===");
  console.log(`NEXT_PUBLIC_STAX_EXECUTOR=${record.address}`);
  console.log(`NEXT_PUBLIC_INFERENCE_VERIFIER=${record.address}`);
  console.log(`NEXT_PUBLIC_IDENTITY_REGISTRY=${registry.address}`);
  console.log(`NEXT_PUBLIC_STAX_AGENT_ID=${agentId}`);
  console.log(`NEXT_PUBLIC_STAX_EXECUTOR_BLOCK=${startBlock}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
