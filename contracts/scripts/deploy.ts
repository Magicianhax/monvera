import hre from "hardhat";

// --- Mantle mainnet constants (verified on-chain 2026-06-01) ---
const USDC = "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9";
const FLUXION_ROUTER = "0x5628a59dF0ECAC3f3171f877A94bEb26BA6DFAa0";

// The 10 wrapped xStocks (USDC pairs on Fluxion) — the AI-executable asset set for the MVP.
// sUSDe / mETH / FBTC are buyable via the manual (Pro) path today; to route them through the
// AI executor too, whitelist the Merchant Moe / Agni routers here as well (TODO when enabled).
const STOCK_TOKENS: `0x${string}`[] = [
  "0x5aa7649fdbda47de64a07ac81d64b682af9c0724", // wAAPLx
  "0x43680abf18cf54898be84c6ef78237cfbd441883", // wTSLAx
  "0x93e62845c1dd5822ebc807ab71a5fb750decd15a", // wNVDAx
  "0x1630f08370917e79df0b7572395a5e907508bbbc", // wGOOGLx
  "0x4e41a262caa93c6575d336e0a4eb79f3c67caa06", // wMETAx
  "0x266e5923f6118f8b340ca5a23ae7f71897361476", // wMSTRx
  "0x953707d7a1cb30cc5c636bda8eaebe410341eb14", // wHOODx
  "0xa90872aca656ebe47bdebf3b19ec9dd9c5adc7f8", // wCRCLx
  "0xc88fcd8b874fdb3256e8b55b3decb8c24eab4c02", // wSPYx
  "0xdbd9232fee15351068fe02f0683146e16d9f2cea", // wQQQx
];

const AGENT_CARD = process.env.AGENT_CARD_URI ?? "https://stax.app/.well-known/agent-card.json";

async function main() {
  const agentSigner = process.env.AGENT_SIGNER_ADDRESS as `0x${string}` | undefined;
  if (!agentSigner) throw new Error("AGENT_SIGNER_ADDRESS not set in .env");

  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();
  const me = deployer.account.address;
  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer: ${me}`);
  console.log(`Agent signer: ${agentSigner}\n`);

  // 1) InferenceVerifier — the EIP-712 risk-inference gate.
  const verifier = await hre.viem.deployContract("InferenceVerifier", [agentSigner]);
  console.log(`InferenceVerifier: ${verifier.address}`);

  // 2) IdentityRegistry — ERC-8004-style agent identity; register the Stax agent.
  const registry = await hre.viem.deployContract("IdentityRegistry", []);
  console.log(`IdentityRegistry:  ${registry.address}`);
  await publicClient.waitForTransactionReceipt({ hash: await registry.write.register([me, AGENT_CARD]) });
  const agentId = (await registry.read.nextAgentId()) - 1n;
  console.log(`Stax agent registered → agentId ${agentId}`);

  // 3) StaxExecutor — commit + verify + non-custodial Fluxion execution.
  const executor = await hre.viem.deployContract("StaxExecutor", [USDC, verifier.address]);
  console.log(`StaxExecutor:      ${executor.address}`);

  // 4) Whitelist the Fluxion router + the 10 stock tokens (wait for each receipt on a live chain).
  await publicClient.waitForTransactionReceipt({ hash: await executor.write.setRouter([FLUXION_ROUTER, true]) });
  await publicClient.waitForTransactionReceipt({ hash: await executor.write.setAssets([STOCK_TOKENS, true]) });
  console.log(`Whitelisted Fluxion router + ${STOCK_TOKENS.length} stock tokens\n`);

  console.log("=== Deployment summary (copy into web/.env.local) ===");
  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        NEXT_PUBLIC_INFERENCE_VERIFIER: verifier.address,
        NEXT_PUBLIC_IDENTITY_REGISTRY: registry.address,
        NEXT_PUBLIC_STAX_EXECUTOR: executor.address,
        NEXT_PUBLIC_STAX_AGENT_ID: agentId.toString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nVerify on Mantlescan, e.g.:`);
  console.log(`  npx hardhat verify --network ${hre.network.name} ${verifier.address} ${agentSigner}`);
  console.log(`  npx hardhat verify --network ${hre.network.name} ${executor.address} ${USDC} ${verifier.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
