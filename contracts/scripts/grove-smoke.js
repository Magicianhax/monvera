const hre = require("hardhat");

// Grove deployment rehearsal + smoke sequence (spec section E.8).
//
// ONE script, two modes, chosen by the network:
//
//   --network hardhat   full rehearsal. Deploys the mock world, wires roles,
//                       queues the timelocks, TIME-TRAVELS past them, creates
//                       the grove and runs all nine smoke steps. Minutes.
//   --network robinhoodTestnet
//                       day 0 only: deploy + wire + QUEUE. The 48h timelock is
//                       real there, so it stops after proposing and prints the
//                       day-2 commands. Never fork the code to shorten TIMELOCK.
//
// Testnet has no USDG, no Chainlink equity feeds and no Kyber (its aggregator
// serves chain slug `robinhood` = 4663 only), so both modes deploy mocks. That
// is the point: testnet proves the STATE MACHINE, not the price. Kyber stays a
// mainnet-only integration, validated by one small real trade.

const TIMELOCK = 48 * 3600;
const U = (n) => BigInt(n) * 10n ** 6n; // USDG raw (6dp)
const S = (n) => BigInt(n) * 10n ** 18n; // stock raw (18dp)
const buyRate = (p6) => 10n ** 36n / p6;
const sellRate = (p6) => p6;
const FOREVER = 2n ** 200n;

// Blue Chips, but only the names a mock feed backs here. Weights sum to 10000.
const BASKET = [
  { sym: "AAPL", price: U(250), weightBps: 3500 },
  { sym: "MSFT", price: U(500), weightBps: 3500 },
  { sym: "NVDA", price: U(180), weightBps: 3000 },
];

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`   PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`   FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function reverts(p, want) {
  try {
    await p;
    return { reverted: false, msg: "" };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    return { reverted: true, matched: !want || msg.includes(want), msg };
  }
}

async function main() {
  const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const publicClient = await hre.viem.getPublicClient();
  const wallets = await hre.viem.getWalletClients();
  const deployer = wallets[0];
  const user = isLocal ? wallets[1] : deployer;
  const managerW = isLocal ? wallets[2] : deployer;
  const guardianW = isLocal ? wallets[3] : deployer;

  const mined = async (hash) => publicClient.waitForTransactionReceipt({ hash });

  console.log(`\nNetwork:  ${hre.network.name}${isLocal ? "  (full rehearsal)" : "  (day 0 only)"}`);
  console.log(`Deployer: ${deployer.account.address}\n`);

  // ── the mock world ────────────────────────────────────────────────────────
  console.log("1. mock environment");
  const usdg = await hre.viem.deployContract("MockERC20", ["USD Gold", "USDG", 6]);
  console.log(`   USDG            ${usdg.address}`);
  const router = await hre.viem.deployContract("MockSwapRouter", []);
  console.log(`   MockSwapRouter  ${router.address}`);

  const toks = [];
  for (const c of BASKET) {
    const t = await hre.viem.deployContract("MockERC20", [c.sym, c.sym, 18]);
    const agg = await hre.viem.deployContract("MockAggregator", [8, c.price * 100n]);
    await mined(await router.write.setRate([usdg.address, t.address, buyRate(c.price)]));
    await mined(await router.write.setRate([t.address, usdg.address, sellRate(c.price)]));
    toks.push({ ...c, t, agg });
    console.log(`   ${c.sym.padEnd(6)} token ${t.address}  feed ${agg.address}`);
  }

  // ── the contract ──────────────────────────────────────────────────────────
  console.log("\n2. GroveManager");
  const treasury = deployer.account.address;
  const gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasury]);
  console.log(`   GroveManager    ${gm.address}`);
  console.log(`   treasury        ${treasury}  (IMMUTABLE — no setter, on purpose)`);

  const managerKey = (process.env.GROVE_MANAGER_KEY || "").trim().split(/\s+/)[0];
  const guardianKey = (process.env.GROVE_GUARDIAN || "").trim().split(/\s+/)[0];
  const mgr = isLocal ? managerW.account.address : managerKey;
  const grd = isLocal ? guardianW.account.address : guardianKey;

  if (mgr) {
    await mined(await gm.write.setManager([mgr]));
    console.log(`   manager         ${mgr}`);
  } else {
    console.log(`   manager         NOT SET — export GROVE_MANAGER_KEY and call setManager (instant)`);
  }
  if (grd) {
    await mined(await gm.write.setGuardian([grd]));
    console.log(`   guardian        ${grd}`);
  } else {
    console.log(`   guardian        NOT SET — export GROVE_GUARDIAN and call setGuardian (instant)`);
  }
  if (!isLocal && grd && grd.toLowerCase() === deployer.account.address.toLowerCase()) {
    console.log(`   WARNING: guardian == owner. The guardian is the only pause and the owner`);
    console.log(`            cannot pause directly — use a different key/device before mainnet.`);
  }

  console.log(`   bandBps         ${await gm.read.bandBps()}   (fresh)`);
  console.log(`   staleBandBps    ${await gm.read.staleBandBps()}  (market closed / sequencer grace)`);
  console.log(`   sequencerFeed   ${await gm.read.sequencerUptimeFeed()}  (0x0 = disabled until 4663 addr verified)`);

  // ── queue everything that is timelocked ───────────────────────────────────
  console.log("\n3. queue timelocked wiring (48h)");
  for (const asApproval of [false, true]) {
    await mined(await gm.write.proposeSwapTarget([router.address, asApproval]));
    console.log(`   swap target     ${router.address}  asApproval=${asApproval}`);
  }
  for (const c of toks) {
    await mined(await gm.write.proposeFeed([c.t.address, c.agg.address, 3600]));
    console.log(`   feed            ${c.sym} -> ${c.agg.address}  heartbeat=3600`);
  }

  if (!isLocal) {
    console.log("\n   Day 0 complete. The 48h timelock is REAL time here.");
    console.log("   After it matures, run these as the owner:");
    for (const a of [false, true]) console.log(`     applySwapTarget("${router.address}", ${a})`);
    for (const c of toks) console.log(`     applyFeed("${c.t.address}")`);
    console.log(`     createGrove("Blue Chips", 1000, [...])   // feeBps IMMUTABLE forever`);
    console.log(`\n   Then re-run this script with --network hardhat to rehearse the smoke steps.`);
    return;
  }

  // ── mature the timelocks ──────────────────────────────────────────────────
  console.log("\n4. travel past the timelock and apply");
  await hre.network.provider.send("evm_increaseTime", [TIMELOCK + 1]);
  await hre.network.provider.send("evm_mine", []);
  for (const asApproval of [false, true]) {
    await mined(await gm.write.applySwapTarget([router.address, asApproval]));
  }
  for (const c of toks) {
    await mined(await gm.write.applyFeed([c.t.address]));
    await mined(await c.agg.write.setAnswer([c.price * 100n])); // re-stamp updatedAt
  }
  console.log("   swap targets and feeds live");

  // ── the one grove ─────────────────────────────────────────────────────────
  console.log("\n5. create the grove");
  await mined(
    await gm.write.createGrove([
      "Blue Chips",
      1000,
      toks.map((c) => ({ token: c.t.address, weightBps: c.weightBps })),
    ]),
  );
  const g = await gm.read.groves([0n]);
  console.log(`   grove 0  "${g[0]}"  feeBps=${g[1]} (10% of PROFIT, immutable)  version=${g[2]}`);

  // fund the user
  await mined(await usdg.write.mint([user.account.address, U(100_000)]));
  await mined(await usdg.write.approve([gm.address, 2n ** 255n], { account: user.account }));
  for (const c of toks) {
    await mined(await c.t.write.approve([gm.address, 2n ** 255n], { account: user.account }));
  }

  const legBuy = (c, amountIn, minOut) => ({
    tokenIn: usdg.address,
    tokenOut: c.t.address,
    amountIn,
    minOut,
    callTarget: router.address,
    approvalTarget: router.address,
    data: router.abi && encodeSwap(c, usdg.address, c.t.address, amountIn),
  });
  const legSell = (c, amountIn, minOut) => ({
    tokenIn: c.t.address,
    tokenOut: usdg.address,
    amountIn,
    minOut,
    callTarget: router.address,
    approvalTarget: router.address,
    data: encodeSwap(c, c.t.address, usdg.address, amountIn),
  });
  function encodeSwap(_c, tokenIn, tokenOut, amountIn) {
    const { encodeFunctionData } = require("viem");
    return encodeFunctionData({
      abi: router.abi,
      functionName: "swap",
      args: [tokenIn, tokenOut, amountIn],
    });
  }

  // ── the nine smoke steps ──────────────────────────────────────────────────
  console.log("\n6. smoke sequence (spec E.8)");
  const bal = (t, who) => t.read.balanceOf([who]);
  const A = toks[0];

  // 1 — an honest buy lands in the user's wallet and the contract keeps nothing
  await mined(
    await gm.write.buy(
      [0n, toks.map((c) => legBuy(c, U(100), 1n)), FOREVER],
      { account: user.account },
    ),
  );
  ok(
    "1  buy: tokens land in the user wallet",
    (await bal(A.t, user.account.address)) > 0n,
    `${await bal(A.t, user.account.address)} raw AAPL`,
  );
  ok("1b contract holds nothing between txs", (await bal(usdg, gm.address)) === 0n);

  // 2 — minOut = 0 is refused for the USER too, not just the manager
  let r = await reverts(
    gm.write.buy([0n, [legBuy(A, U(100), 0n)], FOREVER], { account: user.account }),
    "MinOutRequired",
  );
  ok("2  buy with minOut=0 reverts MinOutRequired", r.reverted && r.matched);

  // 3 — a fill outside the band is refused even with a satisfied minOut
  await mined(await router.write.setDeliverBps([9000n])); // 10% off
  r = await reverts(
    gm.write.buy([0n, [legBuy(A, U(100), 1n)], FOREVER], { account: user.account }),
    "PriceBandBreached",
  );
  ok("3  fill 10% off the feed reverts PriceBandBreached", r.reverted && r.matched);
  await mined(await router.write.setDeliverBps([10_000n]));

  // 4 — rebalance sized from sell minOuts, residue refunded to the user
  const beforeUsdg = await bal(usdg, user.account.address);
  await mined(
    await gm.write.rebalance(
      [0n, [legSell(A, S(1) / 10n, U(24)), legBuy(toks[1], U(24), 1n)], FOREVER],
      { account: user.account },
    ),
  );
  ok(
    "4  rebalance succeeds; residue returns to the user",
    (await bal(usdg, user.account.address)) >= beforeUsdg && (await bal(usdg, gm.address)) === 0n,
  );

  // 5 — the fraction cap stops a 100% sale before any leg executes
  await mined(
    await gm.write.enableAuto([0n, U(1000), U(5000), 3600, 2500], { account: user.account }),
  );
  const held = await bal(A.t, user.account.address);
  r = await reverts(
    gm.write.managedRebalance(
      [user.account.address, 0n, [legSell(A, held, 1n), legBuy(toks[1], U(1), 1n)], FOREVER],
      { account: managerW.account },
    ),
    "RebalanceFractionExceeded",
  );
  ok("5  managed 100% sale reverts RebalanceFractionExceeded", r.reverted && r.matched);

  // 6 — an honest managed rebalance inside the cap works and charges the budget
  const quarter = held / 5n; // 20%, inside the 25% cap
  const sellUsdg = (quarter * A.price) / 10n ** 18n;
  await mined(
    await gm.write.managedRebalance(
      [user.account.address, 0n, [legSell(A, quarter, 1n), legBuy(toks[1], sellUsdg, 1n)], FOREVER],
      { account: managerW.account },
    ),
  );
  const auto = await gm.read.autoConfigs([user.account.address, 0n]);
  ok("6  honest managed rebalance succeeds and charges the budget", auto[3] > 0n, `managerMovedUsdg=${auto[3]}`);

  // 7 — a stale feed locks the manager out; the user can still leave
  await hre.network.provider.send("evm_increaseTime", [2 * 3600]);
  await hre.network.provider.send("evm_mine", []);
  r = await reverts(
    gm.write.managedRebalance(
      [user.account.address, 0n, [legSell(A, quarter, 1n), legBuy(toks[1], sellUsdg, 1n)], FOREVER],
      { account: managerW.account },
    ),
    "StaleFeedForManaged",
  );
  ok("7  stale feed reverts StaleFeedForManaged for the manager", r.reverted && r.matched);
  const stillHeld = await bal(A.t, user.account.address);
  await mined(
    await gm.write.exit([0n, [legSell(A, stillHeld, 1n)], 1000, FOREVER], { account: user.account }),
  );
  ok("7b the user can still exit while the feed is stale", (await bal(A.t, user.account.address)) === 0n);

  // 8 — a full exit clears the position and pays the fee
  for (const c of toks) await mined(await c.agg.write.setAnswer([c.price * 100n])); // refresh
  const pos = await gm.read.positionOf([user.account.address, 0n]);
  const sellAll = [];
  for (let i = 0; i < pos[1].length; i++) {
    if (pos[2][i] > 0n) {
      const c = toks.find((x) => x.t.address.toLowerCase() === pos[1][i].toLowerCase());
      sellAll.push(legSell(c, pos[2][i], 1n));
    }
  }
  const treasBefore = await bal(usdg, treasury);
  await mined(await gm.write.exit([0n, sellAll, 10_000, FOREVER], { account: user.account }));
  const posAfter = await gm.read.positionOf([user.account.address, 0n]);
  ok("8  full exit clears the position", posAfter[0] === 0n && posAfter[1].length === 0);
  ok("8b treasury received the profit fee (0 if no profit)", (await bal(usdg, treasury)) >= treasBefore);

  // 9 — pause stops new money and the manager, never an exit
  await mined(await gm.write.setPaused([true], { account: guardianW.account }));
  r = await reverts(gm.write.buy([0n, [legBuy(A, U(100), 1n)], FOREVER], { account: user.account }), "ContractPaused");
  ok("9  pause blocks buy", r.reverted && r.matched);
  r = await reverts(
    gm.write.managedBuy([user.account.address, 0n, [legBuy(A, U(100), 1n)], FOREVER], {
      account: managerW.account,
    }),
    "ContractPaused",
  );
  ok("9b pause blocks managedBuy", r.reverted && r.matched);
  await mined(await gm.write.buy([0n, [legBuy(A, U(100), 1n)], FOREVER], { account: user.account }).catch(() => null));
  await mined(await gm.write.setPaused([false], { account: guardianW.account }));
  await mined(await gm.write.buy([0n, [legBuy(A, U(100), 1n)], FOREVER], { account: user.account }));
  await mined(await gm.write.setPaused([true], { account: guardianW.account }));
  await mined(await gm.write.closePosition([0n], { account: user.account }));
  ok("9c closePosition works while paused (the hatch)", (await gm.read.positionOf([user.account.address, 0n]))[0] === 0n);

  console.log(`\n   ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
