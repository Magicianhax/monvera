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

// Redeploys ONLY the IdentityRegistry (now carrying a setAgentCard setter so a
// future domain move needs no redeploy) and registers Vera as agentId 1 with the
// correct monvera.best card. VeraRecord / the executor (0x7ff1a5ee...) is left
// untouched, so the recommendation history and the web reader's block-scan floor
// both survive. Requires contracts/.env: PRIVATE_KEY, MONVERA_AGENT_SIGNER.
const AGENT_CARD = "https://monvera.best/.well-known/agent-card.json";

async function main() {
  const agentSigner = (process.env.MONVERA_AGENT_SIGNER || "").trim().split(/\s+/)[0];
  if (!agentSigner) throw new Error("MONVERA_AGENT_SIGNER not set in contracts/.env");

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  console.log(`Network:      ${hre.network.name}`);
  console.log(`Deployer:     ${deployer.account.address}`);
  console.log(`Agent signer: ${agentSigner}\n`);

  const clientPair = { client: { public: publicClient, wallet: deployer } };
  const registry = await hre.viem.deployContract("IdentityRegistry", [], clientPair);
  console.log(`IdentityRegistry (new): ${registry.address}`);

  await publicClient.waitForTransactionReceipt({
    hash: await registry.write.register([agentSigner, AGENT_CARD]),
  });
  const agentId = (await registry.read.nextAgentId()) - 1n;
  const uri = await registry.read.tokenURI([agentId]);
  const owner = await registry.read.ownerOf([agentId]);
  console.log(`Registered agentId ${agentId}`);
  console.log(`  owner:    ${owner}`);
  console.log(`  tokenURI: ${uri}\n`);

  console.log("=== Update web/.env.local ===");
  console.log(`NEXT_PUBLIC_IDENTITY_REGISTRY=${registry.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
