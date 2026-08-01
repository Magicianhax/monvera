const hre = require("hardhat");
const { robinhood, GROVE_MANAGER, VENUES } = require("./lib/constants");
const { readGroveRegistry } = require("./lib/registry");

// Day 2: activate everything the propose scripts queued, once the 48h timelock
// has matured. Safe to re-run — it reports what is already live and skips it,
// and refuses anything still pending rather than reverting the batch.
//
// Venues and tokens come from lib/constants and the registry, never a local
// copy: an earlier version of this script kept its own 7-token list, which
// would have silently skipped a component added to the grove afterwards and
// left it UNPRICEABLE.
//
// Select groves with GROVE_IDS (comma-separated); default is every grove that
// has an onChainId.
//
//   npx hardhat run scripts/grove-apply.js --network robinhood

const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [owner] = await hre.viem.getWalletClients({ chain: robinhood });
  const gm = await hre.viem.getContractAt("GroveManager", GROVE_MANAGER, {
    client: { public: publicClient, wallet: owner },
  });
  const mined = (h) => publicClient.waitForTransactionReceipt({ hash: h });
  const now = Math.floor(Date.now() / 1000);

  const wanted = (process.env.GROVE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const registry = readGroveRegistry();
  const groves = wanted.length
    ? registry.filter((g) => wanted.includes(g.id))
    : registry.filter((g) => g.onChainId !== undefined);
  if (!groves.length) throw new Error(`no groves selected (GROVE_IDS=${process.env.GROVE_IDS || "<unset>"})`);

  console.log(`\nGroveManager ${GROVE_MANAGER}`);
  console.log(`Owner        ${owner.account.address}`);
  console.log(`Groves       ${groves.map((g) => g.id).join(", ")}\n`);

  let pending = 0;

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
      console.log(`  PENDING  ${v.label} — ${((eta - now) / 3600).toFixed(1)}h left`);
      pending++;
    } else {
      await mined(await gm.write.applySwapTarget([v.addr, v.asApproval]));
      console.log(`  APPLIED  ${v.label}`);
    }
  }

  // One entry per token across the selected groves — a feed is per-token.
  const tokens = new Map();
  for (const g of groves) {
    for (const c of g.components) if (!tokens.has(c.address.toLowerCase())) tokens.set(c.address.toLowerCase(), c);
  }

  console.log("\nfeeds");
  for (const c of [...tokens.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const f = await gm.read.feedOf([c.address]);
    if (f[0] !== ZERO) {
      console.log(`  LIVE     ${c.symbol.padEnd(6)} ${f[0]}  heartbeat=${f[1]}s  scalePow=${f[2]}`);
      continue;
    }
    const eta = Number(await gm.read.pendingFeedEta([c.address]));
    if (eta === 0) {
      console.log(`  MISSING  ${c.symbol.padEnd(6)} never proposed — run grove-propose-feeds.js`);
    } else if (now < eta) {
      console.log(`  PENDING  ${c.symbol.padEnd(6)} ${((eta - now) / 3600).toFixed(1)}h left`);
      pending++;
    } else {
      await mined(await gm.write.applyFeed([c.address]));
      const g2 = await gm.read.feedOf([c.address]);
      console.log(`  APPLIED  ${c.symbol.padEnd(6)} ${g2[0]}  heartbeat=${g2[1]}s  scalePow=${g2[2]}`);
    }
  }

  console.log(`\nbands ${await gm.read.bandBps()}/${await gm.read.staleBandBps()} bps`);
  console.log(`manager  ${await gm.read.manager()}`);
  console.log(`guardian ${await gm.read.guardian()}`);
  if (pending) console.log(`\n${pending} item(s) still in timelock — re-run later, then scripts/grove-verify.js.`);
  else console.log(`\nAll applied. Run scripts/grove-verify.js to confirm.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
