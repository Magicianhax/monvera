import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData } from "viem";

const FEED_TIMELOCK = 48 * 3600;

// Governance-surface PoCs: what the OWNER and GUARDIAN can actually do, tested
// against the header claims "the owner can NEVER touch user funds ... or block an
// exit" and "no function can ever trap a user".

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const buyRate = (price6: bigint) => 10n ** 36n / price6;

describe("GroveManager — owner / guardian powers", function () {
  this.timeout(120_000);

  let owner: any, user1: any, managerW: any, guardianW: any, treasuryW: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any, router: any;

  /// token -> { agg, price6 } for every registered feed, so travel() and
  /// setPrice() can keep the oracle consistent with the world. GroveManager now
  /// bands every fill against Chainlink; a fixture whose oracle is frozen while
  /// the router moves is modelling something that cannot happen on chain.
  let feeds: Record<string, { agg: any; price6: bigint }> = {};

  async function refreshFeeds() {
    for (const k of Object.keys(feeds)) {
      await feeds[k].agg.write.setAnswer([(feeds[k].price6 * 100n) as any]);
    }
  }

  /// Raw time travel with NO feed refresh — used while registering feeds, and by
  /// any test that deliberately wants a stale or dead one.
  async function travelOnly(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
  }

  /// Register feeds at the SAME prices the mock router fills at, so an honest
  /// leg lands mid-band. Feed decimals 8, matching the real 4663 equity feeds:
  /// answer = price6 * 1e8 / 1e6. Batched through ONE 48h window — registering
  /// one at a time ages the first past MAX_FEED_AGE before the last lands.
  async function registerFeeds(pairs: Array<[any, bigint]>, heartbeat = 3600) {
    const aggs: any[] = [];
    for (const [token, price6] of pairs) {
      const agg = await hre.viem.deployContract("MockAggregator", [8, (price6 * 100n) as any]);
      await gm.write.proposeFeed([token.address, agg.address, heartbeat]);
      aggs.push(agg);
    }
    await travelOnly(FEED_TIMELOCK + 1);
    for (let i = 0; i < pairs.length; i++) {
      await gm.write.applyFeed([pairs[i][0].address]);
      await aggs[i].write.setAnswer([(pairs[i][1] * 100n) as any]);
      feeds[pairs[i][0].address.toLowerCase()] = { agg: aggs[i], price6: pairs[i][1] };
    }
    return aggs;
  }

  async function travel(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
    await refreshFeeds();
  }
  async function expectRevert(p: Promise<unknown>, err?: string) {
    let failed = false, msg = "";
    try { await p; } catch (e: any) { failed = true; msg = String(e?.message ?? e); }
    expect(failed, `expected revert${err ? ` with ${err}` : ""}`).to.equal(true);
    if (err) expect(msg).to.include(err);
  }
  function swapData(tokenIn: string, tokenOut: string, amountIn: bigint) {
    return encodeFunctionData({ abi: router.abi, functionName: "swap", args: [tokenIn, tokenOut, amountIn] });
  }
  function legBuy(stock: any, amountIn: bigint, minOut: bigint) {
    return { tokenIn: usdg.address, tokenOut: stock.address, amountIn, minOut,
      callTarget: router.address, approvalTarget: router.address,
      data: swapData(usdg.address, stock.address, amountIn) };
  }
  function legSell(stock: any, amountIn: bigint, minOut: bigint) {
    return { tokenIn: stock.address, tokenOut: usdg.address, amountIn, minOut,
      callTarget: router.address, approvalTarget: router.address,
      data: swapData(stock.address, usdg.address, amountIn) };
  }
  async function setPrice(stock: any, price6: bigint) {
    await router.write.setRate([usdg.address, stock.address, buyRate(price6)]);
    await router.write.setRate([stock.address, usdg.address, price6]);
    const key = stock.address.toLowerCase();
    if (feeds[key]) {
      // Keep the oracle with the market: a router repriced without its
      // feed is a 100%-deviation fill the band correctly rejects.
      feeds[key].price6 = price6;
      await feeds[key].agg.write.setAnswer([(price6 * 100n) as any]);
    }
  }

  beforeEach(async () => {
    [owner, user1, managerW, guardianW, treasuryW] = await hre.viem.getWalletClients();
    feeds = {};
    usdg = await hre.viem.deployContract("MockERC20", ["USDG", "USDG", 6]);
    aapl = await hre.viem.deployContract("MockERC20", ["Apple", "AAPL", 18]);
    tsla = await hre.viem.deployContract("MockERC20", ["Tesla", "TSLA", 18]);
    nvda = await hre.viem.deployContract("MockERC20", ["Nvidia", "NVDA", 18]);
    router = await hre.viem.deployContract("MockSwapRouter", []);
    gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasuryW.account.address]);
    await gm.write.setManager([managerW.account.address]);
    await gm.write.setGuardian([guardianW.account.address]);
    await gm.write.proposeSwapTarget([router.address, false]);
    await gm.write.proposeSwapTarget([router.address, true]);
    await travel(TIMELOCK + 1);
    await gm.write.applySwapTarget([router.address, false]);
    await gm.write.applySwapTarget([router.address, true]);
    await gm.write.createGrove(["Blue Chips", 1000, [
      { token: aapl.address, weightBps: 4000 },
      { token: tsla.address, weightBps: 3000 },
      { token: nvda.address, weightBps: 3000 },
    ]]);
    await setPrice(aapl, U(10));
    await setPrice(tsla, U(20));
    await setPrice(nvda, U(25));

    // Oracles agree with the router, so honest fills sit mid-band.
    await registerFeeds([
      [aapl, U(10)],
      [tsla, U(20)],
      [nvda, U(25)],
    ]);
    await usdg.write.mint([user1.account.address, U(50_000)]);
    await usdg.write.approve([gm.address, 2n ** 255n], { account: user1.account });
    for (const t of [aapl, tsla, nvda]) {
      await t.write.approve([gm.address, 2n ** 255n], { account: user1.account });
    }
    await gm.write.buy([0n, [legBuy(aapl, U(100), 1n), legBuy(tsla, U(100), 1n), legBuy(nvda, U(100), 1n)], FOREVER],
      { account: user1.account });
  });

  // The 48h swap-target timelock is NOT the barrier the header implies: the owner
  // needs no new whitelist entry at all. setManager has no timelock, so the owner
  // becomes the manager in one tx and immediately uses the EXISTING legitimate
  // router with hostile calldata.
  // The owner CAN still make itself manager instantly — setManager has no
  // timelock, by design, because disabling a compromised manager must never
  // wait. What changed is that the manager ROLE is no longer worth stealing:
  // every bound it operates under is now denominated in something it cannot
  // author. This test keeps the original attack verbatim and asserts it fails.
  it("FIXED: owner-as-manager still cannot drain an auto-enabled user", async () => {
    await gm.write.enableAuto([0n, U(1), U(1), HOUR, 2_500], { account: user1.account });

    await gm.write.setManager([owner.account.address]); // instant, onlyOwner, no timelock
    await router.write.setDeliverBps([1n], { account: owner.account });
    const legs = [
      legSell(aapl, S(10), 1n), legSell(tsla, S(5), 1n), legSell(nvda, S(4), 1n),
      legBuy(aapl, 30_000n, 1n),
    ];
    // Selling 100% of a holding exceeds the user's 25% per-rebalance fraction,
    // and the check runs on the pre-call snapshot, before any leg executes.
    await expectRevert(
      gm.write.managedRebalance([user1.account.address, 0n, legs, FOREVER], { account: owner.account }),
      "RebalanceFractionExceeded"
    );
    // Inside the fraction cap the band catches the 0.01% fill.
    await expectRevert(
      gm.write.managedRebalance(
        [user1.account.address, 0n, [legSell(aapl, S(2), 1n), legBuy(tsla, 200n, 1n)], FOREVER],
        { account: owner.account }
      ),
      "PriceBandBreached"
    );
    // Holdings untouched.
    expect(await aapl.read.balanceOf([user1.account.address])).to.equal(S(10));
    expect(await tsla.read.balanceOf([user1.account.address])).to.equal(S(5));
    expect(await nvda.read.balanceOf([user1.account.address])).to.equal(S(4));
  });

  // "the owner can never ... block an exit" — the owner CAN block exit() by
  // removing every swap target (instant, by design). closePosition survives.
  it("owner blocks exit() by removing all swap targets; only closePosition survives", async () => {
    await gm.write.removeSwapTarget([router.address, false]);
    await expectRevert(
      gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 100, FOREVER], { account: user1.account }),
      "TargetNotAllowed"
    );
    // Emergency hatch still works — tokens were already in the user's wallet.
    await gm.write.closePosition([0n], { account: user1.account });
    expect(await aapl.read.balanceOf([user1.account.address])).to.equal(S(10));
  });

  // The guardian is not an independent check: the owner rotates it instantly.
  it("owner overrides a guardian pause by rotating the guardian", async () => {
    await gm.write.setPaused([true], { account: guardianW.account });
    await expectRevert(
      gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
      "ContractPaused"
    );
    await gm.write.setGuardian([owner.account.address]);
    await gm.write.setPaused([false], { account: owner.account });
    await gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account });
    // ...and can permanently brick the breaker by pointing it at a dead address.
    await gm.write.setGuardian(["0x000000000000000000000000000000000000dEaD"]);
    await expectRevert(gm.write.setPaused([true], { account: guardianW.account }), "NotGuardian");
  });

  // Cooldown: confirm no double-action, and that enableAuto does NOT reset
  // lastManagerAction (so re-consent cannot be used to skip the wait) — but it
  // DOES reset managerSpentUsdg, refilling the cumulative budget.
  it("cooldown holds across enableAuto, but enableAuto refills the cumulative budget", async () => {
    await gm.write.enableAuto([0n, U(50), U(50), HOUR, 10_000], { account: user1.account });
    await gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(50), 1n)], FOREVER],
      { account: managerW.account });
    let auto = await gm.read.autoConfigs([user1.account.address, 0n]);
    expect(auto[3]).to.equal(U(50)); // managerSpentUsdg — budget exhausted

    // Second action inside the cooldown reverts.
    await expectRevert(
      gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(50), 1n)], FOREVER],
        { account: managerW.account }),
      "CooldownActive"
    );
    // Re-consent does not reset the clock...
    await gm.write.enableAuto([0n, U(50), U(50), HOUR, 10_000], { account: user1.account });
    await expectRevert(
      gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(50), 1n)], FOREVER],
        { account: managerW.account }),
      "CooldownActive"
    );
    // ...but it DID zero managerSpentUsdg, so the lifetime cap starts over.
    auto = await gm.read.autoConfigs([user1.account.address, 0n]);
    expect(auto[3]).to.equal(0n);
    await travel(HOUR + 1);
    await gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(50), 1n)], FOREVER],
      { account: managerW.account });
  });

  // renounceOwnership is inherited and NOT disabled: it permanently freezes
  // setManager, so a later manager compromise can never be rotated away.
  it("renounceOwnership is reachable and permanently freezes manager rotation", async () => {
    await gm.write.renounceOwnership();
    expect(await gm.read.owner()).to.equal("0x0000000000000000000000000000000000000000");
    await expectRevert(gm.write.setManager([owner.account.address]), "OwnableUnauthorizedAccount");
    // The compromised manager key remains authorised forever.
    expect((await gm.read.manager()).toLowerCase()).to.equal(managerW.account.address.toLowerCase());
  });
});
