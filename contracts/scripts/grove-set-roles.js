const hre = require("hardhat");
const { defineChain, getAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Wire GroveManager's two operational roles. Both setters are instant (no
// timelock) on purpose: disabling a compromised manager must never wait 48h.
//
//   manager  — Vera's HOT ops key. Signs managedBuy/managedRebalance unattended
//              for users who opted in, so it needs gas and lives in the server
//              env. Its compromise is the threat model the per-user caps and the
//              oracle band exist to bound.
//   guardian — the pause key. Signs by hand, only in an emergency. MUST differ
//              from the owner: the owner cannot pause directly, and that
//              separation is the entire point of the role.
//
// The manager key is read from the web env file (where the server also reads it)
// so the two can never drift apart. Only its ADDRESS is ever printed.
//
// Run: npx hardhat run scripts/grove-set-roles.js --network robinhood

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});

const GM = process.env.GROVE_MANAGER_ADDRESS || "0x8b707a85b79fbe3a14ce96862bc7f31c05cbbfe6";
const GUARDIAN = "0xca0c8c28EC2f352649B3b9D2b8C673E6254142D6"; // staking cold key
// Resolved relative to this repo, never an absolute local path: this file is
// committed and main-public may become public. Override with GROVE_ENV_FILE.
const WEB_ENV = process.env.GROVE_ENV_FILE || resolve(__dirname, "../../web/.env.local");

function managerAddressFromEnv() {
  let env;
  try {
    env = readFileSync(WEB_ENV, "utf8");
  } catch {
    return null;
  }
  const m = env.match(/^GROVE_MANAGER_KEY\s*=\s*(\S+)/m);
  if (!m) return null;
  const raw = m[1].replace(/^["']|["']$/g, "");
  try {
    return privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`).address;
  } catch {
    return null;
  }
}

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [owner] = await hre.viem.getWalletClients({ chain: robinhood });
  const gm = await hre.viem.getContractAt("GroveManager", GM, {
    client: { public: publicClient, wallet: owner },
  });
  const mined = (h) => publicClient.waitForTransactionReceipt({ hash: h });

  const ownerAddr = getAddress(owner.account.address);
  const guardian = getAddress(GUARDIAN);
  const manager = managerAddressFromEnv();

  console.log(`\nGroveManager ${GM}`);
  console.log(`owner        ${ownerAddr}`);
  console.log(`guardian     ${guardian}`);
  console.log(`manager      ${manager || "GROVE_MANAGER_KEY not found in web/.env.local"}\n`);

  // Separation of duties is the reason these roles exist. Refuse to collapse them.
  if (guardian.toLowerCase() === ownerAddr.toLowerCase()) {
    throw new Error("guardian == owner — the owner cannot pause directly, so this defeats the role");
  }
  if (manager && manager.toLowerCase() === ownerAddr.toLowerCase()) {
    throw new Error("manager == owner — a compromised hot key would then also hold every owner power");
  }
  if (manager && manager.toLowerCase() === guardian.toLowerCase()) {
    throw new Error("manager == guardian — a compromised hot key could pause to cover its tracks");
  }

  const curGuardian = await gm.read.guardian();
  if (curGuardian.toLowerCase() === guardian.toLowerCase()) {
    console.log("guardian already set — skipping");
  } else {
    await mined(await gm.write.setGuardian([guardian]));
    console.log(`guardian set -> ${await gm.read.guardian()}`);
  }

  if (manager) {
    const curManager = await gm.read.manager();
    if (curManager.toLowerCase() === manager.toLowerCase()) {
      console.log("manager already set — skipping");
    } else {
      await mined(await gm.write.setManager([manager]));
      console.log(`manager set  -> ${await gm.read.manager()}`);
    }
    const bal = await publicClient.getBalance({ address: manager });
    console.log(`manager gas  -> ${Number(bal) / 1e18} ETH`);
    if (bal === 0n) {
      console.log(`  NOTE: unfunded. It cannot send managedBuy/managedRebalance until it has`);
      console.log(`  gas. Harmless today — those paths also require a user to call enableAuto,`);
      console.log(`  and none of the auto-manage server logic exists yet.`);
    }
  }

  console.log(`\nfinal: owner=${ownerAddr}`);
  console.log(`       manager=${await gm.read.manager()}`);
  console.log(`       guardian=${await gm.read.guardian()}`);
  console.log(`       paused=${await gm.read.paused()}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
