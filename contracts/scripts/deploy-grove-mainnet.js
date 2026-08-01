const hre = require("hardhat");
const { getAddress } = require("viem");
const { robinhood, USDG, TREASURY, VENUES, FEED_HEARTBEAT } = require("./lib/constants");
const { groveFromRegistry } = require("./lib/registry");

// GroveManager day-0 deploy on Robinhood Chain 4663 — deploy, seed, create,
// all in one run.
//
// `bootstrap` seeds the FIRST venue whitelist and price feeds with no timelock,
// inside an immutable 2h window that opens at deployment and then closes
// forever. That is why this is one script: the window only needs to cover this
// run. Everything added AFTER it still waits the full 48h — see the tests in
// test/bootstrap.test.ts, which is where that claim is actually proved.
//
// Compositions and feed addresses come from web/src/lib/groves.ts via
// lib/registry.js. Nothing here is retyped.
//
//   GROVE_IDS=titan npx hardhat run scripts/deploy-grove-mainnet.js --network robinhood
//
// Then, in order:
//   npx hardhat run scripts/grove-set-roles.js --network robinhood
//   npx hardhat run scripts/grove-verify.js   --network robinhood
//   set NEXT_PUBLIC_GROVE_MANAGER + scripts/lib/constants.js to the new address

async function main() {
  const id = (process.env.GROVE_IDS || "").trim();
  if (!id || id.includes(",")) throw new Error("set GROVE_IDS to exactly one grove id");
  const def = groveFromRegistry(id);

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [deployer] = await hre.viem.getWalletClients({ chain: robinhood });
  const mined = (hash) => publicClient.waitForTransactionReceipt({ hash });

  const bal = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`\nNetwork:  ${hre.network.name} (4663)`);
  console.log(`Deployer: ${deployer.account.address}`);
  console.log(`Balance:  ${Number(bal) / 1e18} ETH`);
  console.log(`Treasury: ${getAddress(TREASURY)}   <-- IMMUTABLE, no setter`);
  console.log(`Grove:    "${def.name}" (${def.id}), ${def.components.length} components\n`);

  // ── deploy ────────────────────────────────────────────────────────────────
  const gm = await hre.viem.deployContract("GroveManager", [USDG, TREASURY], {
    client: { public: publicClient, wallet: deployer },
  });
  console.log(`GroveManager deployed: ${gm.address}`);

  const [onUsdg, onTreasury, band, staleBand, deadline] = await Promise.all([
    gm.read.usdg(),
    gm.read.treasury(),
    gm.read.bandBps(),
    gm.read.staleBandBps(),
    gm.read.bootstrapDeadline(),
  ]);
  console.log(`  usdg (readback):     ${onUsdg}`);
  console.log(`  treasury (readback): ${onTreasury}`);
  console.log(`  bands:               ${band}/${staleBand} bps`);
  console.log(`  bootstrap window closes ${new Date(Number(deadline) * 1000).toISOString()}`);
  if (onUsdg.toLowerCase() !== USDG.toLowerCase()) throw new Error("USDG mismatch — ABORT");
  if (onTreasury.toLowerCase() !== TREASURY.toLowerCase()) throw new Error("treasury mismatch — ABORT");

  // ── seed venues + feeds, no timelock ──────────────────────────────────────
  const callTargets = [...new Set(VENUES.filter((v) => !v.asApproval).map((v) => v.addr))];
  const approvalTargets = [...new Set(VENUES.filter((v) => v.asApproval).map((v) => v.addr))];
  const feedTokens = [];
  const feedAggs = [];
  const heartbeats = [];
  for (const c of def.components) {
    if (!c.feed) throw new Error(`${c.symbol} has no feed in the token registry`);
    if (feedTokens.some((t) => t.toLowerCase() === c.address.toLowerCase())) continue;
    feedTokens.push(c.address);
    feedAggs.push(c.feed);
    heartbeats.push(FEED_HEARTBEAT);
  }

  console.log(`\nbootstrap: ${callTargets.length} call target(s), ${approvalTargets.length} approval target(s), ${feedTokens.length} feed(s) @ ${FEED_HEARTBEAT}s`);
  await mined(await gm.write.bootstrap([callTargets, approvalTargets, feedTokens, feedAggs, heartbeats]));

  for (const v of VENUES) {
    const live = v.asApproval
      ? await gm.read.approvalTargetAllowed([v.addr])
      : await gm.read.callTargetAllowed([v.addr]);
    console.log(`  ${live ? "LIVE   " : "FAILED "} ${v.label}`);
    if (!live) throw new Error(`venue not live after bootstrap: ${v.label}`);
  }
  for (let i = 0; i < feedTokens.length; i++) {
    const f = await gm.read.feedOf([feedTokens[i]]);
    const sym = def.components.find((c) => c.address.toLowerCase() === feedTokens[i].toLowerCase()).symbol;
    console.log(`  ${f[0] !== "0x0000000000000000000000000000000000000000" ? "LIVE   " : "FAILED "} ${sym.padEnd(6)} ${f[0]}  hb=${f[1]}s scalePow=${f[2]}`);
    if (f[0].toLowerCase() !== feedAggs[i].toLowerCase()) throw new Error(`feed mismatch for ${sym}`);
  }

  // ── the grove (no timelock on version 1) ─────────────────────────────────
  console.log(`\nCreating "${def.name}"  feeBps ${def.feeBps} (10% of profit, IMMUTABLE)`);
  await mined(
    await gm.write.createGrove([
      def.name,
      def.feeBps,
      def.components.map((c) => ({ token: getAddress(c.address), weightBps: c.weightBps })),
    ]),
  );
  const groveId = Number(await gm.read.groveCount()) - 1;
  const g = await gm.read.groves([BigInt(groveId)]);
  const comps = await gm.read.groveComposition([BigInt(groveId), g[2]]);
  console.log(`  grove ${groveId}: "${g[0]}"  feeBps=${g[1]}  version=${g[2]}`);
  if (g[0] !== def.name) throw new Error(`name mismatch: "${g[0]}"`);
  if (comps.length !== def.components.length) throw new Error(`component count mismatch`);
  for (let i = 0; i < comps.length; i++) {
    const want = def.components[i];
    const ok = comps[i].token.toLowerCase() === want.address.toLowerCase() && Number(comps[i].weightBps) === want.weightBps;
    console.log(`    ${ok ? "ok  " : "BAD "} ${want.symbol.padEnd(6)} ${Number(comps[i].weightBps) / 100}%`);
    if (!ok) throw new Error(`composition mismatch at ${want.symbol}`);
  }

  const after = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`\nSpent: ${(Number(bal - after) / 1e18).toFixed(8)} ETH   Remaining: ${(Number(after) / 1e18).toFixed(8)} ETH`);
  console.log(`\nLIVE AND TRADEABLE NOW — venues and feeds are seeded, grove ${groveId} exists.`);
  console.log(`\nNext:`);
  console.log(`  1. scripts/lib/constants.js  -> GROVE_MANAGER = "${gm.address}"`);
  console.log(`  2. web/src/lib/groves.ts     -> onChainId: ${groveId} on "${def.id}"`);
  console.log(`  3. web/.env.local            -> NEXT_PUBLIC_GROVE_MANAGER=${gm.address}`);
  console.log(`  4. npx hardhat run scripts/grove-set-roles.js --network robinhood`);
  console.log(`  5. npx hardhat run scripts/grove-verify.js    --network robinhood`);
  console.log(`  6. npx hardhat verify --network robinhood ${gm.address} ${USDG} ${TREASURY}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
