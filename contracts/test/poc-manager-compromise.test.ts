import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData, getAddress } from "viem";

const FEED_TIMELOCK = 48 * 3600;

// ADVERSARIAL PoC — "the manager key is never trusted; every bound is contract-enforced."
// These tests assume the manager key is FULLY COMPROMISED and show the enforced bounds
// (maxPerBuyUsdg / maxTotalUsdg / turnover cap / minOut > 0) are all vacuous, because
// the manager chooses both the route AND the minOut.

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const buyRate = (price6: bigint) => 10n ** 36n / price6;
const sellRate = (price6: bigint) => price6;

describe("GroveManager — compromised manager key", function () {
  this.timeout(120_000);

  let owner: any, user1: any, managerW: any, guardianW: any, treasuryW: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any;

  /// token -> { agg, price6 } for every registered feed, so travel() and
  /// setPrice() can keep the oracle consistent with the world. GroveManager now
  /// bands every fill against Chainlink; a fixture whose oracle is frozen while
  /// the router moves is modelling something that cannot happen on chain.
  let feeds: Record<string, { agg: any; price6: bigint }> = {};

  async function expectRevert(pr: Promise<unknown>, err?: string) {
    let failed = false;
    let msg = "";
    try {
      await pr;
    } catch (e: any) {
      failed = true;
      msg = String(e?.message ?? e);
    }
    expect(failed, `expected revert${err ? ` with ${err}` : ""}, but the call succeeded`).to.equal(true);
    if (err) expect(msg, "revert reason mismatch").to.include(err);
  }

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
  let router: any;
  let treasury: `0x${string}`;

  async function travel(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
    await refreshFeeds();
  }
  function swapData(tokenIn: string, tokenOut: string, amountIn: bigint) {
    return encodeFunctionData({ abi: router.abi, functionName: "swap", args: [tokenIn, tokenOut, amountIn] });
  }
  function legBuy(stock: any, amountIn: bigint, minOut: bigint) {
    return {
      tokenIn: usdg.address, tokenOut: stock.address, amountIn, minOut,
      callTarget: router.address, approvalTarget: router.address,
      data: swapData(usdg.address, stock.address, amountIn),
    };
  }
  function legSell(stock: any, amountIn: bigint, minOut: bigint) {
    return {
      tokenIn: stock.address, tokenOut: usdg.address, amountIn, minOut,
      callTarget: router.address, approvalTarget: router.address,
      data: swapData(stock.address, usdg.address, amountIn),
    };
  }
  async function setPrice(stock: any, price6: bigint) {
    await router.write.setRate([usdg.address, stock.address, buyRate(price6)]);
    await router.write.setRate([stock.address, usdg.address, sellRate(price6)]);
    const key = stock.address.toLowerCase();
    if (feeds[key]) {
      // Keep the oracle with the market: a router repriced without its
      // feed is a 100%-deviation fill the band correctly rejects.
      feeds[key].price6 = price6;
      await feeds[key].agg.write.setAnswer([(price6 * 100n) as any]);
    }
  }
  async function bal(token: any, who: `0x${string}`) {
    return (await token.read.balanceOf([who])) as bigint;
  }
  async function position(user: any, id = 0n) {
    const [costBasis, tokens, amounts] = await gm.read.positionOf([user.account.address, id]);
    const map: Record<string, bigint> = {};
    (tokens as string[]).forEach((t, i) => (map[getAddress(t)] = (amounts as bigint[])[i]));
    return { costBasis: costBasis as bigint, map };
  }

  beforeEach(async () => {
    [owner, user1, managerW, guardianW, treasuryW] = await hre.viem.getWalletClients();
    treasury = treasuryW.account.address;

    feeds = {};
    usdg = await hre.viem.deployContract("MockERC20", ["USDG", "USDG", 6]);
    aapl = await hre.viem.deployContract("MockERC20", ["Apple", "AAPL", 18]);
    tsla = await hre.viem.deployContract("MockERC20", ["Tesla", "TSLA", 18]);
    nvda = await hre.viem.deployContract("MockERC20", ["Nvidia", "NVDA", 18]);
    router = await hre.viem.deployContract("MockSwapRouter", []);

    gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasury]);
    await gm.write.setManager([managerW.account.address]);
    await gm.write.setGuardian([guardianW.account.address]);
    for (const t of [{ a: router.address, ap: false }, { a: router.address, ap: true }]) {
      await gm.write.proposeSwapTarget([t.a, t.ap]);
    }
    await travel(TIMELOCK + 1);
    for (const t of [{ a: router.address, ap: false }, { a: router.address, ap: true }]) {
      await gm.write.applySwapTarget([t.a, t.ap]);
    }
    await gm.write.createGrove([
      "Blue Chips", 1000,
      [
        { token: aapl.address, weightBps: 4000 },
        { token: tsla.address, weightBps: 3000 },
        { token: nvda.address, weightBps: 3000 },
      ],
    ]);
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
  });

  // -------------------------------------------------------------------------
  // PoC A: turnover is the WRONG quantity to bound. turnover == USDG RECEIVED
  // from sell legs, which is exactly what the attacker minimises. The worse the
  // execution, the SMALLER the turnover — so the cap is inversely correlated
  // with the damage and never engages.
  //
  // User authorises the tightest caps the contract allows: $1 per action, $1
  // ever. One managedRebalance liquidates the ENTIRE $300 position.
  // -------------------------------------------------------------------------
  it("PoC A (fixed): the 100%-drain under a $1 cap now reverts, three ways", async () => {
    await gm.write.buy(
      [0n, [legBuy(aapl, U(100), 1n), legBuy(tsla, U(100), 1n), legBuy(nvda, U(100), 1n)], FOREVER],
      { account: user1.account }
    );
    expect((await position(user1)).costBasis).to.equal(U(300));

    // "at most $1 of my money may ever move, $1 at a time, once an hour",
    // and no single rebalance may touch more than 25% of any one holding.
    await gm.write.enableAuto([0n, U(1), U(1), HOUR, 2_500], { account: user1.account });

    // (1) THE ORIGINAL ATTACK. Manager routes through a venue path it controls
    // (0.01% delivered) and sets minOut = 1 wei on every leg. It used to empty
    // the position while the $1 cap read a turnover of 0.03 USDG. The fraction
    // cap now stops it BEFORE any leg executes: 100% of a holding > 25%.
    await router.write.setDeliverBps([1n], { account: managerW.account });
    const drainLegs = [
      legSell(aapl, S(10), 1n),
      legSell(tsla, S(5), 1n),
      legSell(nvda, S(4), 1n),
      legBuy(aapl, 30_000n, 1n),
    ];
    await expectRevert(
      gm.write.managedRebalance([user1.account.address, 0n, drainLegs, FOREVER], {
        account: managerW.account,
      }),
      "RebalanceFractionExceeded"
    );

    // (2) Inside the fraction cap, the PRICE BAND catches the bad fill. 25% of
    // AAPL is allowed structurally, but delivering 0.01% of fair value is not.
    await expectRevert(
      gm.write.managedRebalance(
        [user1.account.address, 0n, [legSell(aapl, S(2), 1n), legBuy(tsla, 200n, 1n)], FOREVER],
        { account: managerW.account }
      ),
      "PriceBandBreached"
    );

    // (3) Honest fills, inside the fraction cap, are still bounded by VALUE —
    // and the value is the ORACLE's, not the measured proceeds the attacker
    // controls. $20 of AAPL against a $1 cap now actually engages.
    await router.write.setDeliverBps([10_000n], { account: managerW.account });
    await expectRevert(
      gm.write.managedRebalance(
        [user1.account.address, 0n, [legSell(aapl, S(2), 1n), legBuy(tsla, U(20), 1n)], FOREVER],
        { account: managerW.account }
      ),
      "RebalanceTurnoverCapExceeded"
    );

    // Nothing moved. The position is exactly as the user left it.
    expect(await bal(aapl, user1.account.address)).to.equal(S(10));
    expect(await bal(tsla, user1.account.address)).to.equal(S(5));
    expect(await bal(nvda, user1.account.address)).to.equal(S(4));
    expect((await position(user1)).costBasis).to.equal(U(300));
    expect(await bal(tsla, router.address)).to.equal(0n);
  });

  // -------------------------------------------------------------------------
  // PoC B: minOut > 0 does not bound managedBuy either, because the manager
  // supplies minOut. maxPerBuyUsdg is extracted in full, per cooldown, until
  // maxTotalUsdg is exhausted.
  // -------------------------------------------------------------------------
  it("PoC B (fixed): managedBuy can no longer convert the per-buy cap into dust", async () => {
    await gm.write.enableAuto([0n, U(1000), U(10_000), HOUR, 2_500], { account: user1.account });
    await router.write.setDeliverBps([1n], { account: managerW.account });

    const usdgBefore = await bal(usdg, user1.account.address);
    const legs = [legBuy(aapl, U(400), 1n), legBuy(tsla, U(300), 1n), legBuy(nvda, U(300), 1n)];

    // minOut = 1 wei still clears minOut — it always would, because the manager
    // authors it. The band is what stops this now: the contract prices the fill
    // itself and refuses anything more than bandBps below the feed.
    await expectRevert(
      gm.write.managedBuy([user1.account.address, 0n, legs, FOREVER], { account: managerW.account }),
      "PriceBandBreached"
    );

    // Not a cent left the user, and no basis was inflated.
    expect(await bal(usdg, user1.account.address)).to.equal(usdgBefore);
    expect((await position(user1)).costBasis).to.equal(0n);

    // An HONEST managed buy at the oracle price still works — the band rejects
    // bad fills, not managed flows.
    await router.write.setDeliverBps([10_000n], { account: managerW.account });
    await gm.write.managedBuy([user1.account.address, 0n, legs, FOREVER], { account: managerW.account });
    expect(usdgBefore - (await bal(usdg, user1.account.address))).to.equal(U(1000));
    expect(await bal(aapl, user1.account.address)).to.equal(S(40));
  });

  // -------------------------------------------------------------------------
  // PoC C: MAX_COMPONENTS (30) > MAX_LEGS (20). A manager can spread a victim's
  // position across more distinct tokens than a single exit() can liquidate,
  // permanently denying the fee-bearing full-exit path (fractionBps == 10000
  // requires EVERY tracked token to reach zero, in <= 20 legs).
  // Demonstrated in miniature: tracked-token count grows monotonically and is
  // never pruned, even for zero-amount credits.
  // -------------------------------------------------------------------------
  it("PoC C: manager can pad the tracked-token list a user must clear on full exit", async () => {
    await gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account });
    let p = await position(user1);
    expect(Object.keys(p.map).length).to.equal(1);

    await gm.write.enableAuto([0n, U(1000), U(10_000), HOUR, 10_000], { account: user1.account });
    // One managed rebalance credits two more composition tokens to the position.
    const legs = [
      legSell(aapl, S(1), 1n), // 1 AAPL -> 10 USDG
      legBuy(tsla, U(5), 1n),
      legBuy(nvda, U(5), 1n),
    ];
    await gm.write.managedRebalance([user1.account.address, 0n, legs, FOREVER], { account: managerW.account });
    p = await position(user1);
    expect(Object.keys(p.map).length).to.equal(3);
    // Every distinct token here must be sold to zero, in one <= 20-leg exit(),
    // for a fractionBps == 10000 exit to succeed.
  });
});
