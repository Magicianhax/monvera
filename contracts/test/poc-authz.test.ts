import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData, getAddress, parseEventLogs } from "viem";

const FEED_TIMELOCK = 48 * 3600;

// Adversarial PoC suite (AUTHZ / GRIEFING / OPS lens) — now a REGRESSION suite for
// the fix. The original PoCs proved (1) a profitable user pays ZERO profit fee by
// passing fractionBps=10000 against only a partial sale (the full-clear branch
// abandoned the unsold winners fee-free), and (2) a manager could bleed an opted-in
// position via minOut=0 rebalances while managerMovedUsdg never moved. The hardened
// contract requires a fractionBps==10000 exit to liquidate every tracked token to
// zero, requires minOut > 0 on every managed leg, and bounds managedRebalance
// turnover to maxPerBuyUsdg. These tests replay the exploits and assert they revert.

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const buyRate = (price6: bigint) => 10n ** 36n / price6;
const sellRate = (price6: bigint) => price6;

describe("GroveManager — adversarial PoC (authz/griefing/ops)", function () {
  this.timeout(120_000);

  let publicClient: any;
  let owner: any, user1: any, user2: any, managerW: any, guardianW: any, treasuryW: any, stranger: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any, goog: any;

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
  let router: any, router2: any, puller: any;
  let treasury: `0x${string}`;

  async function travel(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
    await refreshFeeds();
  }

  async function events(hash: `0x${string}`, eventName: string, abi?: any) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return parseEventLogs({ abi: abi ?? gm.abi, logs: receipt.logs, eventName: eventName as any }) as any[];
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
    expect(failed, `expected revert${err ? ` with ${err}` : ""}, but the call succeeded`).to.equal(true);
    if (err) expect(msg, `revert reason mismatch`).to.include(err);
  }

  function swapData(tokenIn: string, tokenOut: string, amountIn: bigint) {
    return encodeFunctionData({ abi: router.abi, functionName: "swap", args: [tokenIn, tokenOut, amountIn] });
  }
  function legBuy(stock: any, amountIn: bigint, minOut: bigint, overrides: any = {}) {
    return {
      tokenIn: usdg.address, tokenOut: stock.address, amountIn, minOut,
      callTarget: router.address, approvalTarget: router.address,
      data: swapData(usdg.address, stock.address, amountIn), ...overrides,
    };
  }
  function legSell(stock: any, amountIn: bigint, minOut: bigint, overrides: any = {}) {
    return {
      tokenIn: stock.address, tokenOut: usdg.address, amountIn, minOut,
      callTarget: router.address, approvalTarget: router.address,
      data: swapData(stock.address, usdg.address, amountIn), ...overrides,
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
  async function groveStats(id = 0n) {
    const g = await gm.read.groves([id]);
    return { feeBps: g[1], version: g[2], users: g[3] as bigint, basis: g[4] as bigint, inflow: g[5] as bigint, proceeds: g[6] as bigint, fees: g[7] as bigint };
  }
  async function position(user: any, id = 0n) {
    const [costBasis, tokens, amounts] = await gm.read.positionOf([user.account.address, id]);
    const map: Record<string, bigint> = {};
    (tokens as string[]).forEach((t, i) => (map[getAddress(t)] = (amounts as bigint[])[i]));
    return { costBasis: costBasis as bigint, map };
  }
  async function whitelistAll(targets: { addr: string; asApproval: boolean }[]) {
    for (const t of targets) await gm.write.proposeSwapTarget([t.addr, t.asApproval]);
    await travel(TIMELOCK + 1);
    for (const t of targets) await gm.write.applySwapTarget([t.addr, t.asApproval]);
  }
  async function buyBasket(user: any, amounts: [bigint, bigint, bigint] = [U(100), U(100), U(100)]) {
    const legs = [legBuy(aapl, amounts[0], 1n), legBuy(tsla, amounts[1], 1n), legBuy(nvda, amounts[2], 1n)];
    return gm.write.buy([0n, legs, FOREVER], { account: user.account });
  }

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [owner, user1, user2, managerW, guardianW, treasuryW, stranger] = await hre.viem.getWalletClients();
    treasury = treasuryW.account.address;

    feeds = {};
    usdg = await hre.viem.deployContract("MockERC20", ["USDG", "USDG", 6]);
    aapl = await hre.viem.deployContract("MockERC20", ["Apple", "AAPL", 18]);
    tsla = await hre.viem.deployContract("MockERC20", ["Tesla", "TSLA", 18]);
    nvda = await hre.viem.deployContract("MockERC20", ["Nvidia", "NVDA", 18]);
    goog = await hre.viem.deployContract("MockERC20", ["Google", "GOOG", 18]);
    router = await hre.viem.deployContract("MockSwapRouter", []);
    router2 = await hre.viem.deployContract("MockSwapRouter", []);
    puller = await hre.viem.deployContract("MockPuller", []);

    gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasury]);
    await gm.write.setManager([managerW.account.address]);
    await gm.write.setGuardian([guardianW.account.address]);
    await whitelistAll([
      { addr: router.address, asApproval: false },
      { addr: router.address, asApproval: true },
      { addr: puller.address, asApproval: true },
    ]);
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
    for (const u of [user1, user2]) {
      await usdg.write.mint([u.account.address, U(10_000)]);
      await usdg.write.approve([gm.address, 2n ** 255n], { account: u.account });
      for (const t of [aapl, tsla, nvda, goog]) {
        await t.write.approve([gm.address, 2n ** 255n], { account: u.account });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // FINDING 1: fractionBps is decoupled from actual proceeds. A profitable user
  // can withdraw 100% of cost basis (fractionBps=10000) against only a PARTIAL
  // sale, forcing proceeds <= basisWithdrawn => 10% profit fee == 0, while the
  // full-exit branch zeroes ALL token accounting and the user keeps the unsold
  // (appreciated) tokens in their wallet, fee-free.
  // ---------------------------------------------------------------------------
  it("FIXED: the fractionBps=10000 partial-sale fee dodge now REVERTS (IncompleteFullExit)", async () => {
    await buyBasket(user1); // basis 300; holds 10 AAPL, 5 TSLA, 4 NVDA
    // Prices double -> position is worth 600 (100% gain). Honest full exit fee = 10% * (600-300) = 30.
    await setPrice(aapl, U(20));
    await setPrice(tsla, U(40));
    await setPrice(nvda, U(50));

    const userBefore = await bal(usdg, user1.account.address);

    // The dodge: sell ONLY tokens worth <= basis (200 AAPL + 100 TSLA = 300 proceeds),
    // but pass fractionBps = 10000 to withdraw the ENTIRE 300 basis and clear the
    // position, abandoning 2.5 TSLA + 4 NVDA fee-free.
    const legs = [legSell(aapl, S(10), 1n), legSell(tsla, S(5) / 2n, 1n)]; // 10*20 + 2.5*40 = 300
    // Hardened contract: a full-basis (10000) exit must liquidate EVERY tracked token
    // to zero. NVDA (and half the TSLA) are still held, so this reverts.
    await expectRevert(gm.write.exit([0n, legs, 10000, FOREVER], { account: user1.account }), "IncompleteFullExit");

    // Nothing happened: no proceeds, no fee, position and holdings intact.
    expect(await bal(usdg, treasury)).to.equal(0n);
    expect(await bal(usdg, user1.account.address)).to.equal(userBefore);
    const p = await position(user1);
    expect(p.costBasis).to.equal(U(300));
    expect((await groveStats()).users).to.equal(1n);
    expect(await bal(aapl, user1.account.address)).to.equal(S(10));

    // The only 10000 exit the contract accepts is the honest full liquidation, which
    // sells everything and pays the real 30 fee.
    const hash = await gm.write.exit(
      [0n, [legSell(aapl, S(10), 1n), legSell(tsla, S(5), 1n), legSell(nvda, S(4), 1n)], 10000, FOREVER],
      { account: user1.account }
    );
    const ev = (await events(hash, "Exited"))[0];
    expect(ev.args.proceedsUsdg).to.equal(U(600));
    expect(ev.args.feeUsdg).to.equal(U(30));
    expect(await bal(usdg, treasury)).to.equal(U(30));
  });

  // Control: the SAME economic exit done honestly (sell everything, fractionBps=10000)
  // correctly charges 30. Proves the delta above is a real dodge, not a no-op.
  it("CONTROL: honest full liquidation of the same position pays the 30 fee", async () => {
    await buyBasket(user1);
    await setPrice(aapl, U(20));
    await setPrice(tsla, U(40));
    await setPrice(nvda, U(50));
    const legs = [legSell(aapl, S(10), 1n), legSell(tsla, S(5), 1n), legSell(nvda, S(4), 1n)]; // proceeds 600
    const hash = await gm.write.exit([0n, legs, 10000, FOREVER], { account: user1.account });
    const ev = (await events(hash, "Exited"))[0];
    expect(ev.args.proceedsUsdg).to.equal(U(600));
    expect(ev.args.feeUsdg).to.equal(U(30));
    expect(await bal(usdg, treasury)).to.equal(U(30));
  });

  // ---------------------------------------------------------------------------
  // FINDING 2: auto-manage caps (maxPerBuyUsdg / maxTotalUsdg) constrain USDG
  // INFLOW only. managedRebalance is net-zero USDG, so it consumes NO spend
  // budget and its execution quality is bounded solely by manager-chosen minOut.
  // A compromised/faulty manager key can therefore churn an opted-in user's
  // holdings at minOut=0 through a whitelisted venue and bleed value to
  // slippage/MEV every cooldown, WITHOUT the maxTotal cap ever engaging.
  // ---------------------------------------------------------------------------
  it("FIXED: a minOut=0 rebalance reverts, and turnover is bounded by the user's cap", async () => {
    await buyBasket(user1); // basis 300; 10 AAPL, 5 TSLA, 4 NVDA
    // User opts in with a TIGHT total cap of 1 USDG — "the manager may deploy at most
    // 1 USDG of my money, ever." Under the fix this cap ALSO bounds rebalance turnover.
    await gm.write.enableAuto([0n, U(1), U(1), HOUR, 10_000], { account: user1.account });

    // Adverse execution: every swap delivers only 80% of fair value.
    await router.write.setDeliverBps([8000n]);

    const tslaBefore = await bal(tsla, user1.account.address); // 5 TSLA
    const aaplBefore = await bal(aapl, user1.account.address); // 10 AAPL

    // The exploit legs: sell 4 TSLA -> USDG, rebuy AAPL, minOut=0 on both.
    const sellAmt = S(4);
    const legs = [legSell(tsla, sellAmt, 1n), legBuy(aapl, U(64), 1n)];
    // A token minOut is no defence — the manager authors it. The PRICE BAND is:
    // 80% delivery is 2000bps below the feed, far outside the 300bps band.
    await expectRevert(
      gm.write.managedRebalance([user1.account.address, 0n, legs, FOREVER], { account: managerW.account }),
      "PriceBandBreached"
    );

    // And with HONEST execution the value cap still bites: 4 TSLA is $80 of
    // ORACLE value against the user's $1 per-action cap. Note the cap is now
    // denominated in the oracle's number, not the measured proceeds the manager
    // controls — which is exactly what made the old bound bypassable.
    await router.write.setDeliverBps([10_000n]);
    const legsFloored = [legSell(tsla, sellAmt, 1n), legBuy(aapl, U(80), 1n)];
    await expectRevert(
      gm.write.managedRebalance([user1.account.address, 0n, legsFloored, FOREVER], { account: managerW.account }),
      "RebalanceTurnoverCapExceeded"
    );

    // Position and holdings fully intact; no value bled; managerSpent still 0.
    expect(await bal(tsla, user1.account.address)).to.equal(tslaBefore);
    expect(await bal(aapl, user1.account.address)).to.equal(aaplBefore);
    expect((await position(user1)).costBasis).to.equal(U(300));
    const autoAfter = await gm.read.autoConfigs([user1.account.address, 0n]);
    expect(autoAfter[3]).to.equal(0n);
  });
});
