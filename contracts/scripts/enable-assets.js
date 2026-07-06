const hre = require("hardhat");

// Enable the SAFE/CRYPTO tiers on the deployed StaxExecutor so the AI executor +
// manual buy can route them. Whitelists the Agni + Merchant Moe routers and the
// new output tokens (sUSDe, mETH, FBTC) plus the route intermediaries (USDe, WETH).
//
// Routes were validated on-chain via the Mantle swap tooling on 2026-06-01:
//   sUSDe : Agni exactInput  USDC -(100)-> USDe -(500)-> sUSDe
//   mETH  : Agni exactInput  USDC -(100)-> USDT -(2500)-> mETH
//   FBTC  : only Merchant Moe LB routes USDC->FBTC; the leg builder leaves it gated
//           for now, but we still whitelist the token + MM router so it's ready.
//
// Run: npm --prefix D:/Tools/mantle/stax/contracts run enable:mantle
// (owner = deployer in .env PRIVATE_KEY).

const STAX_EXECUTOR = "0x3411196abdc3dbe59c5e2878c44d1931a975af12";

const AGNI_ROUTER = "0x319B69888b0d11cEC22caA5034e25FfFBDc88421";
const MERCHANT_MOE_ROUTER = "0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a";

const SUSDE = "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2";
const METH = "0xcDA86A272531e8640cD7F1a92c01839911B90bb0";
const FBTC = "0xC96dE26018A54D51c097160568752c4E3BD6C364";
const USDE = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34";
const WETH = "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111";

const NEW_ASSETS = [SUSDE, METH, FBTC, USDE, WETH];

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();
  const me = deployer.account.address;
  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer (owner): ${me}\n`);

  const executor = await hre.viem.getContractAt("StaxExecutor", STAX_EXECUTOR);

  const owner = await executor.read.owner();
  if (owner.toLowerCase() !== me.toLowerCase()) {
    throw new Error(`Signer ${me} is not the executor owner (${owner}). Aborting.`);
  }

  const txHashes = {};

  // 1) Whitelist routers.
  const hAgni = await executor.write.setRouter([AGNI_ROUTER, true]);
  await publicClient.waitForTransactionReceipt({ hash: hAgni });
  txHashes.setRouter_agni = hAgni;
  console.log(`setRouter(Agni ${AGNI_ROUTER}, true) -> ${hAgni}`);

  const hMoe = await executor.write.setRouter([MERCHANT_MOE_ROUTER, true]);
  await publicClient.waitForTransactionReceipt({ hash: hMoe });
  txHashes.setRouter_merchantMoe = hMoe;
  console.log(`setRouter(MerchantMoe ${MERCHANT_MOE_ROUTER}, true) -> ${hMoe}`);

  // 2) Whitelist the new output tokens + intermediaries.
  const hAssets = await executor.write.setAssets([NEW_ASSETS, true]);
  await publicClient.waitForTransactionReceipt({ hash: hAssets });
  txHashes.setAssets = hAssets;
  console.log(`setAssets([${NEW_ASSETS.join(", ")}], true) -> ${hAssets}`);

  // 3) Read-back confirmation.
  const checks = {
    routerAllowed_agni: await executor.read.routerAllowed([AGNI_ROUTER]),
    routerAllowed_merchantMoe: await executor.read.routerAllowed([MERCHANT_MOE_ROUTER]),
    assetAllowed_sUSDe: await executor.read.assetAllowed([SUSDE]),
    assetAllowed_mETH: await executor.read.assetAllowed([METH]),
    assetAllowed_FBTC: await executor.read.assetAllowed([FBTC]),
    assetAllowed_USDe: await executor.read.assetAllowed([USDE]),
    assetAllowed_WETH: await executor.read.assetAllowed([WETH]),
  };

  console.log("\n=== Enablement complete ===");
  console.log(JSON.stringify({ txHashes, checks }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
