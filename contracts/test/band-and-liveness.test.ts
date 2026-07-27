import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData } from "viem";

// Coverage for the three things the hardening pass introduced, none of which
// existed before it:
//   1. the Chainlink price band and its degradation ladder (FRESH / STALE /
//      UNPRICEABLE), including the rule that you can never ENTER something the
//      contract cannot price but can always LEAVE;
//   2. the rebalance residue path, which is what makes rebalance() shippable at
//      all — the old exact-consumption rule reverted on any price move between
//      quote and fill;
//   3. the oracle governance asymmetry: loosening waits 48h, tightening is
//      instant, and no path widens past the code ceiling.

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n; // USDG raw (6dp)
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n; // stock raw (18dp)
const buyRate = (price6: bigint) => 10n ** 36n / price6;
const sellRate = (price6: bigint) => price6;

describe("GroveManager — price band, rebalance liveness, oracle governance", function () {
  this.timeout(120_000);

  let publicClient: any;
  let owner: any, user1: any, managerW: any, guardianW: any, treasuryW: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any, router: any;
  let aaplAgg: any, tslaAgg: any, nvdaAgg: any;

  async function travelOnly(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
  }

  async function expectRevert(p: Promise<unknown>, err?: string) {
    let failed = false;
    let msg = "";
    try {
      await p;
    } catch (e: any) {
      failed = true;
      msg = String(e?.message ?? e);
    }
    expect(failed, `expected revert${err ? ` with ${err}` : ""}, but it succeeded`).to.equal(true);
    if (err) expect(msg, "revert reason mismatch").to.include(err);
  }

  function swapData(tokenIn: string, tokenOut: string, amountIn: bigint) {
    return encodeFunctionData({
      abi: router.abi,
      functionName: "swap",
      args: [tokenIn, tokenOut, amountIn],
    });
  }
  const legBuy = (stock: any, amountIn: bigint, minOut: bigint) => ({
    tokenIn: usdg.address,
    tokenOut: stock.address,
    amountIn,
    minOut,
    callTarget: router.address,
    approvalTarget: router.address,
    data: swapData(usdg.address, stock.address, amountIn),
  });
  const legSell = (stock: any, amountIn: bigint, minOut: bigint) => ({
    tokenIn: stock.address,
    tokenOut: usdg.address,
    amountIn,
    minOut,
    callTarget: router.address,
    approvalTarget: router.address,
    data: swapData(stock.address, usdg.address, amountIn),
  });

  async function setPrice(stock: any, price6: bigint) {
    await router.write.setRate([usdg.address, stock.address, buyRate(price6)]);
    await router.write.setRate([stock.address, usdg.address, sellRate(price6)]);
  }
  const bal = (t: any, who: `0x${string}`) => t.read.balanceOf([who]);

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [owner, user1, managerW, guardianW, treasuryW] = await hre.viem.getWalletClients();

    usdg = await hre.viem.deployContract("MockERC20", ["USDG", "USDG", 6]);
    aapl = await hre.viem.deployContract("MockERC20", ["Apple", "AAPL", 18]);
    tsla = await hre.viem.deployContract("MockERC20", ["Tesla", "TSLA", 18]);
    nvda = await hre.viem.deployContract("MockERC20", ["Nvidia", "NVDA", 18]);
    router = await hre.viem.deployContract("MockSwapRouter", []);

    gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasuryW.account.address]);
    await gm.write.setManager([managerW.account.address]);
    await gm.write.setGuardian([guardianW.account.address]);

    for (const asApproval of [false, true]) {
      await gm.write.proposeSwapTarget([router.address, asApproval]);
    }
    await gm.write.createGrove([
      "Band Test",
      1000,
      [
        { token: aapl.address, weightBps: 4000 },
        { token: tsla.address, weightBps: 3000 },
        { token: nvda.address, weightBps: 3000 },
      ],
    ]);
    await setPrice(aapl, U(10));
    await setPrice(tsla, U(20));
    await setPrice(nvda, U(25));

    // Feeds at the router's prices, so an honest fill sits dead-centre.
    aaplAgg = await hre.viem.deployContract("MockAggregator", [8, U(10) * 100n]);
    tslaAgg = await hre.viem.deployContract("MockAggregator", [8, U(20) * 100n]);
    nvdaAgg = await hre.viem.deployContract("MockAggregator", [8, U(25) * 100n]);
    await gm.write.proposeFeed([aapl.address, aaplAgg.address, 3600]);
    await gm.write.proposeFeed([tsla.address, tslaAgg.address, 3600]);
    await gm.write.proposeFeed([nvda.address, nvdaAgg.address, 3600]);

    // One window covers the swap targets and all three feeds.
    await travelOnly(TIMELOCK + 1);
    for (const asApproval of [false, true]) {
      await gm.write.applySwapTarget([router.address, asApproval]);
    }
    for (const [t, agg, p] of [
      [aapl, aaplAgg, U(10)],
      [tsla, tslaAgg, U(20)],
      [nvda, nvdaAgg, U(25)],
    ] as const) {
      await gm.write.applyFeed([(t as any).address]);
      await (agg as any).write.setAnswer([(p as bigint) * 100n]); // re-stamp updatedAt
    }

    await usdg.write.mint([user1.account.address, U(100_000)]);
    await usdg.write.approve([gm.address, 2n ** 255n], { account: user1.account });
    for (const t of [aapl, tsla, nvda]) {
      await t.write.approve([gm.address, 2n ** 255n], { account: user1.account });
    }
  });

  async function buyBasket() {
    await gm.write.buy(
      [0n, [legBuy(aapl, U(100), 1n), legBuy(tsla, U(100), 1n), legBuy(nvda, U(100), 1n)], FOREVER],
      { account: user1.account }
    );
  }

  // ================================================================ the band

  describe("price band", () => {
    it("an honest fill passes; a fill just outside the 3% band reverts (D.11 boundary)", async () => {
      // 9_700 bps delivered == exactly the 300bps band edge. `>=` means the
      // boundary itself passes, so this is the exact tie-break the arithmetic
      // promises: no truncation slop either side of it.
      await router.write.setDeliverBps([9_700n]);
      await gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account });

      // One basis point worse and it is outside.
      await router.write.setDeliverBps([9_699n]);
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
        "PriceBandBreached"
      );
    });

    it("D.7: buy() with minOut = 0 now reverts for the USER too, not just the manager", async () => {
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 0n)], FOREVER], { account: user1.account }),
        "MinOutRequired"
      );
    });

    it("D.9: a DEAD feed blocks buys but never blocks a sell — exits stay sacred", async () => {
      await buyBasket();
      // Age past MAX_FEED_AGE (5 days). The feed is no longer stale, it is dead.
      await travelOnly(6 * 24 * HOUR);

      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
        "FeedRequired"
      );
      // Selling out still works, with minOut as the only floor.
      const before = await bal(usdg, user1.account.address);
      await gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 3_333, FOREVER], { account: user1.account });
      expect((await bal(usdg, user1.account.address)) > before).to.equal(true);
    });

    it("D.9b: a REVERTING aggregator degrades to unpriceable, it does not brick the call", async () => {
      await buyBasket();
      await aaplAgg.write.setReverts([true]);

      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
        "FeedRequired"
      );
      // The try/catch is what makes this an exit rather than a freeze.
      await gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 3_333, FOREVER], { account: user1.account });
      expect(await bal(aapl, user1.account.address)).to.equal(0n);
    });

    it("D.8: a STALE feed widens the band for users and locks the MANAGER out", async () => {
      await buyBasket();
      await gm.write.enableAuto([0n, U(1000), U(5000), HOUR, 10_000], { account: user1.account });

      // Past the 1h heartbeat, inside MAX_FEED_AGE: the weekend case.
      await travelOnly(2 * HOUR);

      // A user fill at 6% off would breach the fresh 300bps band but sits inside
      // the 1000bps stale band.
      await router.write.setDeliverBps([9_400n]);
      await gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account });

      // The manager is locked out entirely while the price is stale — that is
      // the half that matters, because a stale price is exactly when a
      // fair-looking fill is most wrong.
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(100), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "StaleFeedForManaged"
      );
    });

    it("a token with NO feed cannot be entered, but can always be left", async () => {
      await buyBasket();
      await gm.write.removeFeed([aapl.address]); // instant, by design

      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
        "FeedRequired"
      );
      await gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 3_333, FOREVER], { account: user1.account });
      expect(await bal(aapl, user1.account.address)).to.equal(0n);
    });
  });

  // ================================================== rebalance liveness (#3)

  describe("rebalance residue", () => {
    it("D.13: an over-delivering sell no longer reverts; the tail goes to the USER", async () => {
      await buyBasket();
      // Sell 1 AAPL. Quote said 10 USDG, the fill delivers 10 — but the buy leg
      // was sized from the sell's minOut (9.9), which is the server rule. The
      // 0.1 USDG tail is exactly what the old exact-zero rule reverted on.
      const before = await bal(usdg, user1.account.address);
      const hash = await gm.write.rebalance(
        [0n, [legSell(aapl, S(1), U(9)), legBuy(tsla, U(9) + 900_000n, 1n)], FOREVER],
        { account: user1.account }
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");

      // The tail landed with the user, and the contract kept nothing.
      expect((await bal(usdg, user1.account.address)) > before).to.equal(true);
      expect(await bal(usdg, gm.address)).to.equal(0n);
    });

    it("D.14: residue above the cap still reverts — a rebalance is not a cash-out", async () => {
      await buyBasket();
      // Sell 1 AAPL (10 USDG) and buy back only 2 USDG: an 8 USDG tail, far
      // beyond max(3% of 10, 1 USDG).
      await expectRevert(
        gm.write.rebalance([0n, [legSell(aapl, S(1), 1n), legBuy(tsla, U(2), 1n)], FOREVER], {
          account: user1.account,
        }),
        "RebalanceUsdgResidue"
      );
    });

    it("D.15: buy legs sized from sell minOuts never hit RebalanceInsufficientUsdg", async () => {
      await buyBasket();
      // Worst legal case: the sell delivers EXACTLY its minOut.
      await router.write.setDeliverBps([9_800n]); // 9.8 USDG on a 10 USDG sale
      const hash = await gm.write.rebalance(
        [0n, [legSell(aapl, S(1), U(9) + 800_000n), legBuy(tsla, U(9) + 800_000n, 1n)], FOREVER],
        { account: user1.account }
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      expect(await bal(usdg, gm.address)).to.equal(0n);
    });
  });

  // ================================================== oracle governance

  describe("oracle governance", () => {
    it("D.17: tightening is instant, widening waits 48h, and nothing exceeds the code ceiling", async () => {
      await gm.write.tightenBands([100, 500]);
      expect(await gm.read.bandBps()).to.equal(100);
      expect(await gm.read.staleBandBps()).to.equal(500);

      // tightenBands can only ever narrow.
      await expectRevert(gm.write.tightenBands([200, 500]), "BadBand");

      // Widening is a 48h proposal.
      await gm.write.proposeBands([300, 1_000]);
      await expectRevert(gm.write.applyBands(), "TimelockPending");
      await travelOnly(TIMELOCK + 1);
      await gm.write.applyBands();
      expect(await gm.read.bandBps()).to.equal(300);

      // The Gamma lesson: no governance path widens past the code floor.
      await expectRevert(gm.write.proposeBands([501, 1_000]), "BadBand");
      await expectRevert(gm.write.proposeBands([300, 2_001]), "BadBand");
    });

    it("D.16: proposeFeed waits 48h; removeFeed is instant", async () => {
      const agg = await hre.viem.deployContract("MockAggregator", [8, U(10) * 100n]);
      await gm.write.proposeFeed([aapl.address, agg.address, 3600]);
      await expectRevert(gm.write.applyFeed([aapl.address]), "TimelockPending");
      await travelOnly(TIMELOCK + 1);
      await gm.write.applyFeed([aapl.address]);
      expect((await gm.read.feedOf([aapl.address]))[0]).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );

      await gm.write.removeFeed([aapl.address]); // no wait
      expect((await gm.read.feedOf([aapl.address]))[0]).to.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });

    it("D.18: proposeFeed rejects a dead aggregator and a zero heartbeat", async () => {
      const dead = await hre.viem.deployContract("MockAggregator", [8, U(10) * 100n]);
      await dead.write.setReverts([true]);
      await expectRevert(gm.write.proposeFeed([aapl.address, dead.address, 3600]), "BadFeed");
      await expectRevert(gm.write.proposeFeed([aapl.address, aaplAgg.address, 0]), "BadFeed");
    });

    it("only the owner touches feeds or bands", async () => {
      await expectRevert(
        gm.write.proposeFeed([aapl.address, aaplAgg.address, 3600], { account: user1.account }),
        "OwnableUnauthorizedAccount"
      );
      await expectRevert(gm.write.removeFeed([aapl.address], { account: user1.account }), "OwnableUnauthorizedAccount");
      await expectRevert(gm.write.tightenBands([100, 500], { account: user1.account }), "OwnableUnauthorizedAccount");
    });
  });
});
