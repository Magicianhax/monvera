const hre = require("hardhat");
const { defineChain } = require("viem");

// Day 2: activate everything deploy-grove-mainnet.js queued, once the 48h
// timelock has matured. Safe to re-run — it reports what is already live and
// skips it, and refuses anything still pending rather than reverting the batch.
//
// Run: npx hardhat run scripts/grove-apply.js --network robinhood

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
});

const GM = process.env.GROVE_MANAGER_ADDRESS || "0x8b707a85b79fbe3a14ce96862bc7f31c05cbbfe6";

const VENUES = [
  { addr: "0x8876789976dEcBfCbBbe364623C63652db8C0904", asApproval: false, label: "UniversalRouter (call)" },
  { addr: "0x000000000022D473030F116dDEE9F6B43aC78BA3", asApproval: true, label: "Permit2 (approve)" },
  { addr: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", asApproval: false, label: "Kyber router (call)" },
  { addr: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", asApproval: true, label: "Kyber router (approve)" },
];

const TOKENS = [
  ["AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
  ["MSFT", "0xe93237C50D904957Cf27E7B1133b510C669c2e74"],
  ["NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
  ["GOOGL", "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3"],
  ["AMZN", "0x12f190a9F9d7D37a250758b26824B97CE941bF54"],
  ["META", "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35"],
  ["TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
];

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [owner] = await hre.viem.getWalletClients({ chain: robinhood });
  const gm = await hre.viem.getContractAt("GroveManager", GM, {
    client: { public: publicClient, wallet: owner },
  });
  const mined = (h) => publicClient.waitForTransactionReceipt({ hash: h });
  const now = Math.floor(Date.now() / 1000);

  console.log(`\nGroveManager ${GM}`);
  console.log(`Owner        ${owner.account.address}\n`);

  console.log("swap targets");
  for (const v of VENUES) {
    const live = v.asApproval
      ? await gm.read.approvalTargetAllowed([v.addr])
      : await gm.read.callTargetAllowed([v.addr]);
    if (live) {
      console.log(`  LIVE     ${v.label}`);
      continue;
    }
    const eta = Number(
      v.asApproval ? await gm.read.pendingApprovalTargetEta([v.addr]) : await gm.read.pendingCallTargetEta([v.addr]),
    );
    if (eta === 0) {
      console.log(`  MISSING  ${v.label} — never proposed`);
    } else if (now < eta) {
      console.log(`  PENDING  ${v.label} — ${Math.ceil((eta - now) / 60)} min left`);
    } else {
      await mined(await gm.write.applySwapTarget([v.addr, v.asApproval]));
      console.log(`  APPLIED  ${v.label}`);
    }
  }

  console.log("\nfeeds");
  for (const [sym, token] of TOKENS) {
    const f = await gm.read.feedOf([token]);
    if (f[0] !== "0x0000000000000000000000000000000000000000") {
      console.log(`  LIVE     ${sym.padEnd(6)} ${f[0]}  heartbeat=${f[1]}  scalePow=${f[2]}`);
      continue;
    }
    const eta = Number(await gm.read.pendingFeedEta([token]));
    if (eta === 0) {
      console.log(`  MISSING  ${sym} — never proposed`);
    } else if (now < eta) {
      console.log(`  PENDING  ${sym} — ${Math.ceil((eta - now) / 60)} min left`);
    } else {
      await mined(await gm.write.applyFeed([token]));
      const g = await gm.read.feedOf([token]);
      console.log(`  APPLIED  ${sym.padEnd(6)} ${g[0]}  heartbeat=${g[1]}  scalePow=${g[2]}`);
    }
  }

  console.log(`\nbandBps ${await gm.read.bandBps()}  staleBandBps ${await gm.read.staleBandBps()}`);
  console.log(`manager ${await gm.read.manager()}`);
  console.log(`guardian ${await gm.read.guardian()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
