import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData, getAddress, parseEventLogs } from "viem";

// GroveManager test suite. Deploys fresh mocks per test:
//  - MockERC20 USDG (6dp) + four 18dp stock tokens
//  - MockSwapRouter that can lie (deliver less), pull partially, or re-enter
//  - MockPuller for the approval-target != call-target (LiFi) shape
// Prices are set on the router as rates: out = in * rate / 1e18.

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const BPS = 10_000n;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n; // USDG raw units
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n; // stock raw units
// usdg(6dp) -> stock(18dp): rate such that price6 USDG buys 1e18 stock
const buyRate = (price6: bigint) => 10n ** 36n / price6;
// stock(18dp) -> usdg(6dp): 1e18 stock yields price6 USDG
const sellRate = (price6: bigint) => price6;

describe("GroveManager", function () {
  this.timeout(120_000);

  let publicClient: any;
  let owner: any, user1: any, user2: any, managerW: any, guardianW: any, treasuryW: any, stranger: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any, goog: any;
  let router: any, router2: any, puller: any;
  let aaplFeed: any, tslaFeed: any, nvdaFeed: any, googFeed: any;
  let treasury: `0x${string}`;

  // ---------------------------------------------------------------- helpers

  /// token address -> { agg, price6 }. Every registered feed, so travel() and
  /// setPrice() can keep the oracle consistent with the world.
  let feeds: Record<string, { agg: any; price6: bigint }> = {};

  /// Advance time AND re-publish every feed, because Chainlink does not stop
  /// publishing while a cooldown elapses. Without this, any test that travels
  /// past a heartbeat turns every managed leg into StaleFeedForManaged and every
  /// buy into a wide-band fill — testing the fixture, not the contract.
  async function travel(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
    await refreshFeeds();
  }

  /// Re-stamp updatedAt on every feed at its current price.
  async function refreshFeeds() {
    for (const k of Object.keys(feeds)) {
      const f = feeds[k];
      await f.agg.write.setAnswer([(f.price6 * 100n) as any]);
    }
  }

  /// Raw travel with NO feed refresh — for tests that deliberately want a stale
  /// or dead feed.
  async function travelOnly(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
  }

  /// Register Chainlink feeds for several tokens at the SAME prices the mock
  /// router fills at, so an honest leg lands dead-centre in the band. Feed
  /// decimals are 8, matching the real equity feeds on 4663:
  ///   answer = price6 * 1e8 / 1e6 = price6 * 100
  ///
  /// Batched through ONE 48h window on purpose. Registering them one at a time
  /// travels 48h per feed, so with four feeds the first is 6 days old by the
  /// time the last lands — past MAX_FEED_AGE (5 days) — and every leg on it
  /// reverts FeedRequired before the test even starts. The final setAnswer pass
  /// re-stamps updatedAt to now so all feeds enter the test FRESH.
  async function registerFeeds(pairs: Array<[any, bigint]>, heartbeat = 3600) {
    const aggs: any[] = [];
    for (const [token, price6] of pairs) {
      const agg = await hre.viem.deployContract("MockAggregator", [8, (price6 * 100n) as any]);
      await gm.write.proposeFeed([token.address, agg.address, heartbeat]);
      aggs.push(agg);
    }
    await travelOnly(TIMELOCK + 1);
    for (let i = 0; i < pairs.length; i++) {
      await gm.write.applyFeed([pairs[i][0].address]);
      await aggs[i].write.setAnswer([(pairs[i][1] * 100n) as any]);
      feeds[pairs[i][0].address.toLowerCase()] = { agg: aggs[i], price6: pairs[i][1] };
    }
    return aggs;
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

  async function events(hash: `0x${string}`, eventName: string, abi?: any) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return parseEventLogs({ abi: abi ?? gm.abi, logs: receipt.logs, eventName: eventName as any }) as any[];
  }

  function swapData(tokenIn: string, tokenOut: string, amountIn: bigint) {
    return encodeFunctionData({
      abi: router.abi,
      functionName: "swap",
      args: [tokenIn, tokenOut, amountIn],
    });
  }

  function legBuy(stock: any, amountIn: bigint, minOut: bigint, overrides: any = {}) {
    return {
      tokenIn: usdg.address,
      tokenOut: stock.address,
      amountIn,
      minOut,
      callTarget: router.address,
      approvalTarget: router.address,
      data: swapData(usdg.address, stock.address, amountIn),
      ...overrides,
    };
  }

  function legSell(stock: any, amountIn: bigint, minOut: bigint, overrides: any = {}) {
    return {
      tokenIn: stock.address,
      tokenOut: usdg.address,
      amountIn,
      minOut,
      callTarget: router.address,
      approvalTarget: router.address,
      data: swapData(stock.address, usdg.address, amountIn),
      ...overrides,
    };
  }

  async function setPrice(stock: any, price6: bigint) {
    await router.write.setRate([usdg.address, stock.address, buyRate(price6)]);
    await router.write.setRate([stock.address, usdg.address, sellRate(price6)]);
    const key = stock.address.toLowerCase();
    if (feeds[key]) {
      // Keep the oracle with the market. A router repriced without its feed
      // is a 100%-deviation fill, which the band correctly rejects — that
      // would be the fixture failing, not the contract.
      feeds[key].price6 = price6;
      await feeds[key].agg.write.setAnswer([(price6 * 100n) as any]);
    }
  }


  async function groveStats(id = 0n) {
    const g = await gm.read.groves([id]);
    return {
      name: g[0] as string,
      feeBps: g[1] as number,
      version: g[2] as number,
      users: g[3] as bigint,
      basis: g[4] as bigint,
      inflow: g[5] as bigint,
      proceeds: g[6] as bigint,
      fees: g[7] as bigint,
    };
  }

  async function position(user: any, id = 0n) {
    const [costBasis, tokens, amounts] = await gm.read.positionOf([user.account.address, id]);
    const map: Record<string, bigint> = {};
    (tokens as string[]).forEach((t, i) => (map[getAddress(t)] = (amounts as bigint[])[i]));
    return { costBasis: costBasis as bigint, map };
  }

  async function bal(token: any, who: `0x${string}`) {
    return (await token.read.balanceOf([who])) as bigint;
  }

  // Contract must be flat (non-custodial) outside a transaction.
  async function expectContractEmpty() {
    for (const t of [usdg, aapl, tsla, nvda, goog]) {
      expect(await bal(t, gm.address)).to.equal(0n);
    }
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

  // ---------------------------------------------------------------- fixture

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
      "Blue Chips",
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

    // Oracles agree with the router, so an honest fill sits mid-band.
    [aaplFeed, tslaFeed, nvdaFeed, googFeed] = await registerFeeds([
      [aapl, U(10)],
      [tsla, U(20)],
      [nvda, U(25)],
      [goog, U(50)],
    ]);

    for (const u of [user1, user2]) {
      await usdg.write.mint([u.account.address, U(10_000)]);
      await usdg.write.approve([gm.address, 2n ** 255n], { account: u.account });
      for (const t of [aapl, tsla, nvda, goog]) {
        await t.write.approve([gm.address, 2n ** 255n], { account: u.account });
      }
    }
  });

  // ================================================================ creation & governance

  describe("grove creation", () => {
    it("stores the grove and emits GroveCreated + CompositionUpdated v1", async () => {
      const hash = await gm.write.createGrove([
        "Second",
        250,
        [
          { token: aapl.address, weightBps: 5000 },
          { token: tsla.address, weightBps: 2500 },
          { token: nvda.address, weightBps: 2500 },
        ],
      ]);
      const created = await events(hash, "GroveCreated");
      expect(created.length).to.equal(1);
      expect(created[0].args.groveId).to.equal(1n);
      expect(created[0].args.name).to.equal("Second");
      expect(created[0].args.feeBps).to.equal(250);
      const comp = await events(hash, "CompositionUpdated");
      expect(comp[0].args.version).to.equal(1);
      expect(comp[0].args.tokens.map((a: string) => getAddress(a))).to.deep.equal(
        [aapl.address, tsla.address, nvda.address].map((a: string) => getAddress(a))
      );
      expect(comp[0].args.weightsBps).to.deep.equal([5000, 2500, 2500]);
      expect(await gm.read.groveCount()).to.equal(2n);
      const g = await groveStats(1n);
      expect(g.feeBps).to.equal(250);
      expect(g.version).to.equal(1);
    });

    it("rejects feeBps above 10%", async () => {
      await expectRevert(
        gm.write.createGrove([
          "TooGreedy",
          1001,
          [
            { token: aapl.address, weightBps: 4000 },
            { token: tsla.address, weightBps: 3000 },
            { token: nvda.address, weightBps: 3000 },
          ],
        ]),
        "FeeTooHigh"
      );
    });

    it("rejects bad compositions: too few, bad weight sum, duplicate token, USDG as component", async () => {
      const twoOnly = [
        { token: aapl.address, weightBps: 5000 },
        { token: tsla.address, weightBps: 5000 },
      ];
      await expectRevert(gm.write.createGrove(["X", 0, twoOnly]), "BadComposition");

      const badSum = [
        { token: aapl.address, weightBps: 4000 },
        { token: tsla.address, weightBps: 3000 },
        { token: nvda.address, weightBps: 2999 },
      ];
      await expectRevert(gm.write.createGrove(["X", 0, badSum]), "BadComposition");

      const dupe = [
        { token: aapl.address, weightBps: 4000 },
        { token: aapl.address, weightBps: 3000 },
        { token: nvda.address, weightBps: 3000 },
      ];
      await expectRevert(gm.write.createGrove(["X", 0, dupe]), "BadComposition");

      const usdgComp = [
        { token: usdg.address, weightBps: 4000 },
        { token: tsla.address, weightBps: 3000 },
        { token: nvda.address, weightBps: 3000 },
      ];
      await expectRevert(gm.write.createGrove(["X", 0, usdgComp]), "BadComposition");
    });

    it("only the owner can create groves / set manager / set guardian", async () => {
      const comp = [
        { token: aapl.address, weightBps: 4000 },
        { token: tsla.address, weightBps: 3000 },
        { token: nvda.address, weightBps: 3000 },
      ];
      await expectRevert(gm.write.createGrove(["X", 0, comp], { account: user1.account }), "OwnableUnauthorizedAccount");
      await expectRevert(gm.write.setManager([user1.account.address], { account: user1.account }), "OwnableUnauthorizedAccount");
      await expectRevert(gm.write.setGuardian([user1.account.address], { account: user1.account }), "OwnableUnauthorizedAccount");
    });

    it("setManager / setGuardian emit their events", async () => {
      const h1 = await gm.write.setManager([stranger.account.address]);
      expect((await events(h1, "ManagerUpdated"))[0].args.manager).to.equal(getAddress(stranger.account.address));
      const h2 = await gm.write.setGuardian([stranger.account.address]);
      expect((await events(h2, "GuardianUpdated"))[0].args.guardian).to.equal(getAddress(stranger.account.address));
    });

    it("the owner has no path to change an existing grove's feeBps", async () => {
      // Belt: the ABI simply contains no fee setter.
      const feeSetters = gm.abi.filter(
        // "feed" contains "fee" — exclude the Chainlink price-feed admin functions,
        // which have nothing to do with a grove's feeBps.
        (f: any) =>
          f.type === "function" &&
          /fee/i.test(f.name) &&
          !/feed/i.test(f.name) &&
          f.stateMutability !== "view"
      );
      expect(feeSetters).to.deep.equal([]);
      // Braces: a composition change does not touch feeBps.
      await gm.write.proposeComposition([
        0n,
        [
          { token: aapl.address, weightBps: 5000 },
          { token: tsla.address, weightBps: 2500 },
          { token: goog.address, weightBps: 2500 },
        ],
      ]);
      await travel(TIMELOCK + 1);
      await gm.write.applyComposition([0n]);
      expect((await groveStats()).feeBps).to.equal(1000);
    });
  });

  describe("composition timelock", () => {
    const newComp = () => [
      { token: aapl.address, weightBps: 5000 },
      { token: tsla.address, weightBps: 2500 },
      { token: goog.address, weightBps: 2500 },
    ];

    it("propose emits, early apply reverts, post-48h apply bumps the version", async () => {
      const h = await gm.write.proposeComposition([0n, newComp()]);
      expect((await events(h, "CompositionProposed"))[0].args.groveId).to.equal(0n);

      await expectRevert(gm.write.applyComposition([0n]), "TimelockPending");
      await travel(TIMELOCK - 60);
      await expectRevert(gm.write.applyComposition([0n]), "TimelockPending");

      await travel(120);
      const h2 = await gm.write.applyComposition([0n]);
      const upd = (await events(h2, "CompositionUpdated"))[0];
      expect(upd.args.version).to.equal(2);
      expect((await groveStats()).version).to.equal(2);

      // New version live, old version still queryable for historical events.
      const v2 = await gm.read.groveComposition([0n, 2]);
      expect(v2.map((c: any) => getAddress(c.token))).to.deep.equal(
        [aapl.address, tsla.address, goog.address].map((a: string) => getAddress(a))
      );
      const v1 = await gm.read.groveComposition([0n, 1]);
      expect(v1.length).to.equal(3);
      expect(getAddress(v1[2].token)).to.equal(getAddress(nvda.address));
    });

    it("apply with nothing pending reverts; buys follow the ACTIVE version", async () => {
      await expectRevert(gm.write.applyComposition([0n]), "NothingPending");

      await gm.write.proposeComposition([0n, newComp()]);
      await travel(TIMELOCK + 1);
      await gm.write.applyComposition([0n]);
      await setPrice(goog, U(50));

      // NVDA was dropped in v2 — buying it now must revert.
      await expectRevert(
        gm.write.buy([0n, [legBuy(nvda, U(100), 1n)], FOREVER], { account: user1.account }),
        "TokenNotInComposition"
      );
      // GOOG is new in v2 — buying it works.
      await gm.write.buy([0n, [legBuy(goog, U(100), S(2))], FOREVER], { account: user1.account });
      expect(await bal(goog, user1.account.address)).to.equal(S(2));
    });
  });

  describe("swap-target whitelist timelock", () => {
    it("adding waits 48h; early apply reverts; then works", async () => {
      const h = await gm.write.proposeSwapTarget([router2.address, false]);
      expect((await events(h, "SwapTargetProposed"))[0].args.asApproval).to.equal(false);
      await expectRevert(gm.write.applySwapTarget([router2.address, false]), "TimelockPending");
      await travel(TIMELOCK + 1);
      const h2 = await gm.write.applySwapTarget([router2.address, false]);
      expect((await events(h2, "SwapTargetAdded"))[0].args.target).to.equal(getAddress(router2.address));
      expect(await gm.read.callTargetAllowed([router2.address])).to.equal(true);
    });

    it("removal is instant and blocks further buys through that venue", async () => {
      const h = await gm.write.removeSwapTarget([router.address, false]);
      expect((await events(h, "SwapTargetRemoved"))[0].args.target).to.equal(getAddress(router.address));
      await expectRevert(buyBasket(user1), "TargetNotAllowed");
      // Exits that need no venue still work: nothing to trap here (no position yet).
    });
  });

  // ================================================================ happy paths

  describe("buy", () => {
    it("3-leg basket: tokens land in the user's wallet, accounting and event exact, contract holds nothing", async () => {
      const before = await bal(usdg, user1.account.address);
      const hash = await buyBasket(user1); // 100/100/100 at $10/$20/$25

      expect(await bal(aapl, user1.account.address)).to.equal(S(10));
      expect(await bal(tsla, user1.account.address)).to.equal(S(5));
      expect(await bal(nvda, user1.account.address)).to.equal(S(4));
      // USDG spent == sum of leg amountIns, to the unit.
      expect(before - (await bal(usdg, user1.account.address))).to.equal(U(300));

      const p = await position(user1);
      expect(p.costBasis).to.equal(U(300));
      expect(p.map[getAddress(aapl.address)]).to.equal(S(10));
      expect(p.map[getAddress(tsla.address)]).to.equal(S(5));
      expect(p.map[getAddress(nvda.address)]).to.equal(S(4));

      const g = await groveStats();
      expect(g.users).to.equal(1n);
      expect(g.basis).to.equal(U(300));
      expect(g.inflow).to.equal(U(300));
      expect(g.proceeds).to.equal(0n);
      expect(g.fees).to.equal(0n);

      const ev = (await events(hash, "Bought"))[0];
      expect(ev.args.user).to.equal(getAddress(user1.account.address));
      expect(ev.args.groveId).to.equal(0n);
      expect(ev.args.usdgIn).to.equal(U(300));
      expect(ev.args.legs).to.equal(3n);

      await expectContractEmpty();
    });

    it("multiple buys accumulate cost basis (average cost, not FIFO)", async () => {
      await gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }); // $10 -> 10 sh
      await setPrice(aapl, U(20));
      await gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }); // $20 -> 5 sh

      const p = await position(user1);
      expect(p.costBasis).to.equal(U(200));
      expect(p.map[getAddress(aapl.address)]).to.equal(S(15));
      const g = await groveStats();
      expect(g.inflow).to.equal(U(200));
      expect(g.users).to.equal(1n); // still one user
    });

    it("rejects: token outside composition, non-USDG tokenIn, zero total, unknown grove", async () => {
      await expectRevert(
        gm.write.buy([0n, [legBuy(goog, U(100), 1n)], FOREVER], { account: user1.account }),
        "TokenNotInComposition"
      );
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, S(1), 1n, { tokenIn: tsla.address })], FOREVER], { account: user1.account }),
        "LegTokenNotUsdg"
      );
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, 0n, 1n)], FOREVER], { account: user1.account }),
        "BuyLegTooSmall"
      );
      await expectRevert(
        gm.write.buy([7n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
        "GroveUnknown"
      );
    });
  });

  describe("exit fee math", () => {
    beforeEach(async () => {
      await buyBasket(user1); // basis 300: 10 AAPL, 5 TSLA, 4 NVDA
    });

    it("partial exit at a profit: fee checked to the unit, basis reduced pro-rata", async () => {
      // Prices double: $20 / $40 / $50.
      await setPrice(aapl, U(20));
      await setPrice(tsla, U(40));
      await setPrice(nvda, U(50));

      const userBefore = await bal(usdg, user1.account.address);
      // Sell half of everything: proceeds 100+100+100 = 300.
      const legs = [
        legSell(aapl, S(5), U(100)),
        legSell(tsla, S(5) / 2n, U(100)),
        legSell(nvda, S(2), U(100)),
      ];
      const hash = await gm.write.exit([0n, legs, 5000, FOREVER], { account: user1.account });

      // basisWithdrawn = 150, profit = 150, fee = 10% = 15, user nets 285.
      expect(await bal(usdg, treasury)).to.equal(U(15));
      expect((await bal(usdg, user1.account.address)) - userBefore).to.equal(U(285));

      const p = await position(user1);
      expect(p.costBasis).to.equal(U(150));
      expect(p.map[getAddress(aapl.address)]).to.equal(S(5));
      expect(p.map[getAddress(tsla.address)]).to.equal(S(5) / 2n);
      expect(p.map[getAddress(nvda.address)]).to.equal(S(2));

      const g = await groveStats();
      expect(g.basis).to.equal(U(150));
      expect(g.proceeds).to.equal(U(300));
      expect(g.fees).to.equal(U(15));
      expect(g.users).to.equal(1n);

      const ev = (await events(hash, "Exited"))[0];
      expect(ev.args.user).to.equal(getAddress(user1.account.address));
      expect(ev.args.proceedsUsdg).to.equal(U(300));
      expect(ev.args.feeUsdg).to.equal(U(15));
      expect(ev.args.fractionBps).to.equal(5000);

      await expectContractEmpty();
    });

    it("second profitable exit after a partial: fee computed on the REDUCED basis", async () => {
      await setPrice(aapl, U(20));
      await setPrice(tsla, U(40));
      await setPrice(nvda, U(50));
      await gm.write.exit(
        [0n, [legSell(aapl, S(5), 1n), legSell(tsla, S(5) / 2n, 1n), legSell(nvda, S(2), 1n)], 5000, FOREVER],
        { account: user1.account }
      );
      // Remaining basis 150. Full exit of the rest at the same prices: proceeds 300.
      const userBefore = await bal(usdg, user1.account.address);
      const hash = await gm.write.exit(
        [0n, [legSell(aapl, S(5), 1n), legSell(tsla, S(5) / 2n, 1n), legSell(nvda, S(2), 1n)], 10000, FOREVER],
        { account: user1.account }
      );
      // profit = 300 - 150 = 150, fee 15, user nets 285.
      const ev = (await events(hash, "Exited"))[0];
      expect(ev.args.proceedsUsdg).to.equal(U(300));
      expect(ev.args.feeUsdg).to.equal(U(15));
      expect((await bal(usdg, user1.account.address)) - userBefore).to.equal(U(285));
      expect(await bal(usdg, treasury)).to.equal(U(30)); // both exits' fees

      // Full exit clears the position and the user count.
      const p = await position(user1);
      expect(p.costBasis).to.equal(0n);
      expect(Object.keys(p.map).length).to.equal(0);
      const g = await groveStats();
      expect(g.users).to.equal(0n);
      expect(g.basis).to.equal(0n);
      await expectContractEmpty();
    });

    it("exit at a loss charges exactly zero fee", async () => {
      // Prices halve: $5 / $10 / $12.5.
      await setPrice(aapl, U(5));
      await setPrice(tsla, U(10));
      await setPrice(nvda, U(25) / 2n);

      const userBefore = await bal(usdg, user1.account.address);
      const hash = await gm.write.exit(
        [0n, [legSell(aapl, S(10), 1n), legSell(tsla, S(5), 1n), legSell(nvda, S(4), 1n)], 10000, FOREVER],
        { account: user1.account }
      );
      // Proceeds 50+50+50 = 150 against basis 300: loss, fee must be 0.
      const ev = (await events(hash, "Exited"))[0];
      expect(ev.args.proceedsUsdg).to.equal(U(150));
      expect(ev.args.feeUsdg).to.equal(0n);
      expect(await bal(usdg, treasury)).to.equal(0n);
      expect((await bal(usdg, user1.account.address)) - userBefore).to.equal(U(150));
      expect((await groveStats()).fees).to.equal(0n);
    });

    it("rejects: bad fraction, selling more than bought-through-contract, no position, non-USDG tokenOut", async () => {
      await expectRevert(gm.write.exit([0n, [legSell(aapl, S(1), 1n)], 0, FOREVER], { account: user1.account }), "BadFraction");
      await expectRevert(gm.write.exit([0n, [legSell(aapl, S(1), 1n)], 10001, FOREVER], { account: user1.account }), "BadFraction");
      await expectRevert(
        gm.write.exit([0n, [legSell(aapl, S(11), 1n)], 10000, FOREVER], { account: user1.account }),
        "InsufficientPositionAmount"
      );
      await expectRevert(
        gm.write.exit([0n, [legSell(aapl, S(1), 1n)], 10000, FOREVER], { account: user2.account }),
        "NoPosition"
      );
      await expectRevert(
        gm.write.exit([0n, [legSell(aapl, S(1), 1n, { tokenOut: tsla.address })], 10000, FOREVER], {
          account: user1.account,
        }),
        "LegTokenNotUsdg"
      );
    });
  });

  describe("rebalance", () => {
    beforeEach(async () => {
      await buyBasket(user1); // 10 AAPL, 5 TSLA, 4 NVDA, basis 300
    });

    it("sell->buy with zero fee, unchanged basis, exact token accounting, no USDG residue", async () => {
      // Sell 5 AAPL ($10 -> 50 USDG), buy TSLA with all 50 ($20 -> 2.5).
      const legs = [legSell(aapl, S(5), U(50)), legBuy(tsla, U(50), S(5) / 2n)];
      const hash = await gm.write.rebalance([0n, legs, FOREVER], { account: user1.account });

      const p = await position(user1);
      expect(p.costBasis).to.equal(U(300)); // untouched
      expect(p.map[getAddress(aapl.address)]).to.equal(S(5));
      expect(p.map[getAddress(tsla.address)]).to.equal(S(15) / 2n); // 5 + 2.5

      const g = await groveStats();
      expect(g.basis).to.equal(U(300));
      expect(g.fees).to.equal(0n);
      expect(g.proceeds).to.equal(0n); // rebalance proceeds are not exit proceeds

      const ev = (await events(hash, "Rebalanced"))[0];
      expect(ev.args.user).to.equal(getAddress(user1.account.address));
      await expectContractEmpty();
    });

    it("reverts if sell proceeds are not fully reinvested (USDG residue)", async () => {
      const legs = [legSell(aapl, S(5), U(50)), legBuy(tsla, U(40), 1n)];
      await expectRevert(gm.write.rebalance([0n, legs, FOREVER], { account: user1.account }), "RebalanceUsdgResidue");
    });

    it("reverts if a buy leg wants more USDG than sells produced", async () => {
      const legs = [legSell(aapl, S(5), U(50)), legBuy(tsla, U(60), 1n)];
      await expectRevert(gm.write.rebalance([0n, legs, FOREVER], { account: user1.account }), "RebalanceInsufficientUsdg");
    });

    it("reverts on a leg with USDG on neither side, and on buying outside the composition", async () => {
      const weird = [legSell(aapl, S(1), 1n, { tokenOut: tsla.address })];
      await expectRevert(gm.write.rebalance([0n, weird, FOREVER], { account: user1.account }), "BadRebalanceLeg");
      const outside = [legSell(aapl, S(5), 1n), legBuy(goog, U(50), 1n)];
      await expectRevert(gm.write.rebalance([0n, outside, FOREVER], { account: user1.account }), "TokenNotInComposition");
    });
  });

  // ================================================================ auto-manage

  describe("auto-manage", () => {
    it("enableAuto validates caps and cooldown floor and emits", async () => {
      await expectRevert(gm.write.enableAuto([0n, U(100), U(200), HOUR - 1, 10_000], { account: user1.account }), "CooldownTooShort");
      await expectRevert(gm.write.enableAuto([0n, 0n, U(200), HOUR, 10_000], { account: user1.account }), "BadAutoCaps");
      await expectRevert(gm.write.enableAuto([0n, U(100), U(50), HOUR, 10_000], { account: user1.account }), "BadAutoCaps");
      await expectRevert(gm.write.enableAuto([9n, U(100), U(200), HOUR, 10_000], { account: user1.account }), "GroveUnknown");

      const hash = await gm.write.enableAuto([0n, U(100), U(150), HOUR, 10_000], { account: user1.account });
      const ev = (await events(hash, "AutoEnabled"))[0];
      expect(ev.args.user).to.equal(getAddress(user1.account.address));
      expect(ev.args.maxPerBuyUsdg).to.equal(U(100));
      expect(ev.args.maxTotalUsdg).to.equal(U(150));
      expect(ev.args.minSecondsBetween).to.equal(BigInt(HOUR));
    });

    it("managedBuy works inside caps, spends the user's own USDG, credits the user's position", async () => {
      await gm.write.enableAuto([0n, U(100), U(150), HOUR, 10_000], { account: user1.account });
      const before = await bal(usdg, user1.account.address);
      const hash = await gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(100), S(10))], FOREVER], {
        account: managerW.account,
      });
      expect(before - (await bal(usdg, user1.account.address))).to.equal(U(100));
      expect(await bal(aapl, user1.account.address)).to.equal(S(10));
      const ev = (await events(hash, "Bought"))[0];
      expect(ev.args.user).to.equal(getAddress(user1.account.address)); // credited to the USER
      const auto = await gm.read.autoConfigs([user1.account.address, 0n]);
      expect(auto[3]).to.equal(U(100)); // managerMovedUsdg
    });

    it("enforces maxPerBuy", async () => {
      await gm.write.enableAuto([0n, U(100), U(1000), HOUR, 10_000], { account: user1.account });
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(101), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "PerBuyCapExceeded"
      );
    });

    it("enforces the CUMULATIVE maxTotal across buys", async () => {
      await gm.write.enableAuto([0n, U(100), U(150), HOUR, 10_000], { account: user1.account });
      await gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(100), 1n)], FOREVER], {
        account: managerW.account,
      });
      await travel(HOUR + 1);
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(100), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "TotalCapExceeded"
      );
      // 50 fits exactly into the remaining budget.
      await gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(50), 1n)], FOREVER], {
        account: managerW.account,
      });
      await travel(HOUR + 1);
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(11), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "TotalCapExceeded"
      );
    });

    it("enforces the cooldown between ANY two manager actions (buy then rebalance)", async () => {
      await buyBasket(user1);
      await gm.write.enableAuto([0n, U(100), U(1000), HOUR, 10_000], { account: user1.account });
      await gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(100), 1n)], FOREVER], {
        account: managerW.account,
      });
      const rebLegs = [legSell(aapl, S(5), 1n), legBuy(tsla, U(50), 1n)];
      await expectRevert(
        gm.write.managedRebalance([user1.account.address, 0n, rebLegs, FOREVER], { account: managerW.account }),
        "CooldownActive"
      );
      await travel(HOUR + 1);
      await gm.write.managedRebalance([user1.account.address, 0n, rebLegs, FOREVER], { account: managerW.account });
      // Rebalance consumed the cooldown too.
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(10), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "CooldownActive"
      );
    });

    it("revoke is instant and emits; manager is locked out immediately", async () => {
      await gm.write.enableAuto([0n, U(100), U(1000), HOUR, 10_000], { account: user1.account });
      const hash = await gm.write.revokeAuto([0n], { account: user1.account });
      expect((await events(hash, "AutoRevoked"))[0].args.user).to.equal(getAddress(user1.account.address));
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(10), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "AutoNotEnabled"
      );
    });

    it("manager cannot act for a user who never opted in; strangers cannot use manager entrypoints", async () => {
      await expectRevert(
        gm.write.managedBuy([user2.account.address, 0n, [legBuy(aapl, U(10), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "AutoNotEnabled"
      );
      await gm.write.enableAuto([0n, U(100), U(1000), HOUR, 10_000], { account: user1.account });
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(10), 1n)], FOREVER], {
          account: stranger.account,
        }),
        "NotManager"
      );
      await expectRevert(
        gm.write.managedRebalance([user1.account.address, 0n, [legSell(aapl, S(1), 1n)], FOREVER], {
          account: stranger.account,
        }),
        "NotManager"
      );
    });
  });

  // ================================================================ isolation

  describe("per-user isolation", () => {
    it("one user's full exit leaves the other position and the grove aggregates exact", async () => {
      await buyBasket(user1); // basis 300
      await gm.write.buy([0n, [legBuy(aapl, U(100), 1n), legBuy(tsla, U(50), 1n)], FOREVER], {
        account: user2.account,
      }); // basis 150: 10 AAPL, 2.5 TSLA

      expect((await groveStats()).users).to.equal(2n);
      expect((await groveStats()).basis).to.equal(U(450));

      await setPrice(aapl, U(20));
      await setPrice(tsla, U(40));
      await setPrice(nvda, U(50));
      await gm.write.exit(
        [0n, [legSell(aapl, S(10), 1n), legSell(tsla, S(5), 1n), legSell(nvda, S(4), 1n)], 10000, FOREVER],
        { account: user1.account }
      );

      // user2 untouched, to the unit.
      const p2 = await position(user2);
      expect(p2.costBasis).to.equal(U(150));
      expect(p2.map[getAddress(aapl.address)]).to.equal(S(10));
      expect(p2.map[getAddress(tsla.address)]).to.equal(S(5) / 2n);
      expect(await bal(aapl, user2.account.address)).to.equal(S(10));

      const g = await groveStats();
      expect(g.users).to.equal(1n);
      expect(g.basis).to.equal(U(150));
      expect(g.inflow).to.equal(U(450));
      expect(g.proceeds).to.equal(U(600)); // 200+200+200 at doubled prices
      expect(g.fees).to.equal(U(30)); // 10% of (600-300)
      await expectContractEmpty();
    });
  });

  // ================================================================ security

  describe("security", () => {
    it("a router that re-enters the contract is stopped by the reentrancy guard", async () => {
      await router.write.setReenter([
        gm.address,
        encodeFunctionData({ abi: gm.abi, functionName: "closePosition", args: [0n] }),
      ]);
      await expectRevert(buyBasket(user1), "ReentrancyGuard");
      // Nothing happened at all.
      expect(await bal(usdg, user1.account.address)).to.equal(U(10_000));
      expect((await groveStats()).users).to.equal(0n);
    });

    it("a router that re-enters exit() during an exit is stopped too", async () => {
      await buyBasket(user1);
      await router.write.setReenter([
        gm.address,
        encodeFunctionData({
          abi: gm.abi,
          functionName: "exit",
          args: [0n, [legSell(aapl, S(1), 1n)], 1000, FOREVER],
        }),
      ]);
      await expectRevert(
        gm.write.exit([0n, [legSell(aapl, S(1), 1n)], 1000, FOREVER], { account: user1.account }),
        "ReentrancyGuard"
      );
      expect((await position(user1)).costBasis).to.equal(U(300));
    });

    it("non-whitelisted call target and non-whitelisted approval target both revert", async () => {
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n, { callTarget: router2.address })], FOREVER], {
          account: user1.account,
        }),
        "TargetNotAllowed"
      );
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n, { approvalTarget: router2.address })], FOREVER], {
          account: user1.account,
        }),
        "ApprovalTargetNotAllowed"
      );
    });

    it("a whitelisted-by-mistake token contract is still rejected as a call target", async () => {
      await whitelistAll([{ addr: aapl.address, asApproval: false }]);
      const leg = legBuy(aapl, U(100), 1n, { callTarget: aapl.address });
      await expectRevert(gm.write.buy([0n, [leg], FOREVER], { account: user1.account }), "TargetIsToken");
    });

    it("a lying router (delivers less than promised) reverts the WHOLE tx via balance-delta verification", async () => {
      await router.write.setDeliverBps([9000n]);
      // minOut = the honest amount; the router will deliver 90% of it.
      const legs = [legBuy(aapl, U(100), S(10)), legBuy(tsla, U(100), S(5))];
      await expectRevert(gm.write.buy([0n, legs, FOREVER], { account: user1.account }), "OutputBelowMin");
      // Atomicity: no partial fills, no money moved.
      expect(await bal(usdg, user1.account.address)).to.equal(U(10_000));
      expect(await bal(aapl, user1.account.address)).to.equal(0n);
      await expectContractEmpty();
    });

    it("a router that consumes the approval only partially trips the exact-spend check", async () => {
      await router.write.setPullBps([5000n]);
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, U(100), 1n)], FOREVER], { account: user1.account }),
        "SpendMismatch"
      );
      expect(await bal(usdg, user1.account.address)).to.equal(U(10_000));
    });

    it("no dangling approvals after a successful buy", async () => {
      await buyBasket(user1);
      expect(await usdg.read.allowance([gm.address, router.address])).to.equal(0n);
    });

    it("the LiFi shape works: approval target differs from call target, both whitelisted in their roles", async () => {
      await router.write.setPuller([puller.address]);
      const leg = legBuy(aapl, U(100), S(10), { approvalTarget: puller.address });
      await gm.write.buy([0n, [leg], FOREVER], { account: user1.account });
      expect(await bal(aapl, user1.account.address)).to.equal(S(10));
      expect(await usdg.read.allowance([gm.address, puller.address])).to.equal(0n);
      await expectContractEmpty();
    });

    it("pause blocks buy and manager actions but NOT exit", async () => {
      await buyBasket(user1);
      await gm.write.enableAuto([0n, U(100), U(1000), HOUR, 10_000], { account: user1.account });

      await expectRevert(gm.write.setPaused([true], { account: owner.account }), "NotGuardian");
      const hash = await gm.write.setPaused([true], { account: guardianW.account });
      expect((await events(hash, "PauseSet"))[0].args.paused).to.equal(true);

      await expectRevert(buyBasket(user2), "ContractPaused");
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(10), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "ContractPaused"
      );
      await expectRevert(
        gm.write.managedRebalance([user1.account.address, 0n, [legSell(aapl, S(1), 1n)], FOREVER], {
          account: managerW.account,
        }),
        "ContractPaused"
      );

      // Exit is sacred: it works while paused, fee math intact.
      await gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 5000, FOREVER], { account: user1.account });
      expect((await position(user1)).costBasis).to.equal(U(150));

      // User-initiated rebalance also keeps working while paused (pause stops
      // new money in and manager keys only).
      await gm.write.rebalance([0n, [legSell(tsla, S(5), U(100)), legBuy(nvda, U(100), 1n)], FOREVER], {
        account: user1.account,
      });

      await gm.write.setPaused([false], { account: guardianW.account });
      await buyBasket(user2); // unpaused: buys work again
    });

    it("closePosition works while paused: zeroes accounting, charges no fee, emits", async () => {
      await buyBasket(user1);
      await gm.write.setPaused([true], { account: guardianW.account });

      const usdgBefore = await bal(usdg, user1.account.address);
      const hash = await gm.write.closePosition([0n], { account: user1.account });
      const ev = (await events(hash, "PositionClosed"))[0];
      expect(ev.args.user).to.equal(getAddress(user1.account.address));
      expect(ev.args.costBasisCleared).to.equal(U(300));

      const p = await position(user1);
      expect(p.costBasis).to.equal(0n);
      expect(Object.keys(p.map).length).to.equal(0);
      const g = await groveStats();
      expect(g.users).to.equal(0n);
      expect(g.basis).to.equal(0n);
      expect(g.fees).to.equal(0n);
      expect(await bal(usdg, treasury)).to.equal(0n);
      // No swaps happened: user still holds the tokens and their USDG.
      expect(await bal(usdg, user1.account.address)).to.equal(usdgBefore);
      expect(await bal(aapl, user1.account.address)).to.equal(S(10));

      await expectRevert(gm.write.closePosition([0n], { account: user1.account }), "NoPosition");
    });

    it("expired deadline reverts buy, exit and rebalance", async () => {
      await buyBasket(user1);
      await expectRevert(gm.write.buy([0n, [legBuy(aapl, U(10), 1n)], 1n], { account: user1.account }), "DeadlineExpired");
      await expectRevert(
        gm.write.exit([0n, [legSell(aapl, S(1), 1n)], 10000, 1n], { account: user1.account }),
        "DeadlineExpired"
      );
      await expectRevert(
        gm.write.rebalance([0n, [legSell(aapl, S(1), 1n)], 1n], { account: user1.account }),
        "DeadlineExpired"
      );
    });

    it("leg cap: 21 legs revert, 0 legs revert", async () => {
      const legs = Array.from({ length: 21 }, () => legBuy(aapl, U(1), 1n));
      await expectRevert(gm.write.buy([0n, legs, FOREVER], { account: user1.account }), "BadLegCount");
      await expectRevert(gm.write.buy([0n, [], FOREVER], { account: user1.account }), "BadLegCount");
    });
  });

  // ================================================================ invariants

  describe("accounting invariants over a long scenario", () => {
    it("cumulative counters, activeUserCount and basis stay exact through mixed activity", async () => {
      // Step 1: u1 buys the full basket (300).
      await buyBasket(user1);
      let g = await groveStats();
      expect([g.users, g.basis, g.inflow, g.proceeds, g.fees]).to.deep.equal([1n, U(300), U(300), 0n, 0n]);
      await expectContractEmpty();

      // Step 2: u2 buys AAPL 100 + TSLA 50.
      await gm.write.buy([0n, [legBuy(aapl, U(100), 1n), legBuy(tsla, U(50), 1n)], FOREVER], {
        account: user2.account,
      });
      g = await groveStats();
      expect([g.users, g.basis, g.inflow]).to.deep.equal([2n, U(450), U(450)]);

      // Step 3: u1 tops up NVDA 60.
      await gm.write.buy([0n, [legBuy(nvda, U(60), 1n)], FOREVER], { account: user1.account });
      g = await groveStats();
      expect([g.users, g.basis, g.inflow]).to.deep.equal([2n, U(510), U(510)]);

      // Prices double.
      await setPrice(aapl, U(20));
      await setPrice(tsla, U(40));
      await setPrice(nvda, U(50));

      // Step 4: u1 exits 25% — sells 2.5 AAPL (50) + 1.25 TSLA (50) = 100 proceeds.
      // basisWithdrawn = 360 * 25% = 90, profit 10, fee 1.
      await gm.write.exit(
        [0n, [legSell(aapl, S(5) / 2n, U(50)), legSell(tsla, S(5) / 4n, U(50))], 2500, FOREVER],
        { account: user1.account }
      );
      g = await groveStats();
      expect([g.users, g.basis, g.inflow, g.proceeds, g.fees]).to.deep.equal([2n, U(420), U(510), U(100), U(1)]);
      expect((await position(user1)).costBasis).to.equal(U(270));
      await expectContractEmpty();

      // Step 5: u2 rebalances 1 AAPL -> TSLA (20 USDG through the pool). No counter moves.
      await gm.write.rebalance([0n, [legSell(aapl, S(1), U(20)), legBuy(tsla, U(20), 1n)], FOREVER], {
        account: user2.account,
      });
      g = await groveStats();
      expect([g.users, g.basis, g.inflow, g.proceeds, g.fees]).to.deep.equal([2n, U(420), U(510), U(100), U(1)]);

      // Step 6: u2 full exit — sells 9 AAPL (180) + 3 TSLA (120) = 300 proceeds.
      // basisWithdrawn 150, profit 150, fee 15.
      await gm.write.exit([0n, [legSell(aapl, S(9), 1n), legSell(tsla, S(3), 1n)], 10000, FOREVER], {
        account: user2.account,
      });
      g = await groveStats();
      expect([g.users, g.basis, g.inflow, g.proceeds, g.fees]).to.deep.equal([1n, U(270), U(510), U(400), U(16)]);
      expect(await bal(usdg, treasury)).to.equal(U(16));
      await expectContractEmpty();

      // Step 7: u1 walks away via closePosition — accounting zeroed, no fee.
      await gm.write.closePosition([0n], { account: user1.account });
      g = await groveStats();
      expect([g.users, g.basis, g.inflow, g.proceeds, g.fees]).to.deep.equal([0n, 0n, U(510), U(400), U(16)]);
      expect(await bal(usdg, treasury)).to.equal(U(16));
      await expectContractEmpty();
    });
  });

  // ================================================================ hardening (post-review fixes)

  describe("hardening: exit fee cannot be dodged by front-loading pooled basis", () => {
    beforeEach(async () => {
      await buyBasket(user1); // basis 300: 10 AAPL, 5 TSLA, 4 NVDA
    });

    it("full exit (fractionBps==10000) reverts unless every tracked token is sold to zero", async () => {
      // Winner moons; flats stay at cost. Try to withdraw 100% of pooled basis
      // while selling ONLY the appreciated token and abandoning TSLA/NVDA.
      await setPrice(aapl, U(50));
      await expectRevert(
        gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 10000, FOREVER], { account: user1.account }),
        "IncompleteFullExit"
      );
      // Selling everything (the honest full liquidation) is what a 10000 exit means.
      const treasuryBefore = await bal(usdg, treasury);
      await gm.write.exit(
        [0n, [legSell(aapl, S(10), 1n), legSell(tsla, S(5), 1n), legSell(nvda, S(4), 1n)], 10000, FOREVER],
        { account: user1.account }
      );
      // proceeds = 500 + 100 + 100 = 700, basisWithdrawn 300, fee 10% * 400 = 40.
      expect((await bal(usdg, treasury)) - treasuryBefore).to.equal(U(40));
      expect((await position(user1)).costBasis).to.equal(0n);
      expect((await groveStats()).users).to.equal(0n);
      await expectContractEmpty();
    });

    it("a partial exit keeps the remaining basis on the position (fee follows the still-held tokens)", async () => {
      await setPrice(aapl, U(50));
      // Sell only the winner, but with fractionBps < 10000 the position survives and
      // the residual basis stays attached to the un-sold tokens.
      await gm.write.exit([0n, [legSell(aapl, S(10), 1n)], 9999, FOREVER], { account: user1.account });
      const p = await position(user1);
      expect(p.costBasis > 0n).to.equal(true); // basis retained, not abandoned
      expect(p.map[getAddress(tsla.address)]).to.equal(S(5)); // flats still tracked
      expect(p.map[getAddress(nvda.address)]).to.equal(S(4));
      expect((await groveStats()).users).to.equal(1n); // still counted, not cleared
    });
  });

  describe("hardening: managed flows cannot redirect a user's value to a third party", () => {
    it("managedBuy rejects a leg with minOut==0 (would let a redirected output pass with out==0)", async () => {
      await gm.write.enableAuto([0n, U(1000), U(5000), HOUR, 10_000], { account: user1.account });
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [legBuy(aapl, U(100), 0n)], FOREVER], {
          account: managerW.account,
        }),
        "MinOutRequired"
      );
    });

    it("a real redirect-router drain via managedBuy reverts, funds stay with the user", async () => {
      const redirect = await hre.viem.deployContract("MockRedirectRouter", []);
      await redirect.write.setRate([usdg.address, aapl.address, buyRate(U(10))]);
      await redirect.write.setRecipient([stranger.account.address]); // attacker
      await whitelistAll([
        { addr: redirect.address, asApproval: false },
        { addr: redirect.address, asApproval: true },
      ]);
      await gm.write.enableAuto([0n, U(1000), U(5000), HOUR, 10_000], { account: user1.account });

      const userBefore = await bal(usdg, user1.account.address);
      const attackerBefore = await bal(aapl, stranger.account.address);
      // Manager routes the user's USDG through a whitelisted venue whose output goes
      // to the attacker (out == 0). With minOut required > 0 the whole tx reverts.
      const evilLeg = {
        tokenIn: usdg.address,
        tokenOut: aapl.address,
        amountIn: U(1000),
        minOut: 1n, // even a token floor is enough: full redirect delivers out == 0
        callTarget: redirect.address,
        approvalTarget: redirect.address,
        data: swapData(usdg.address, aapl.address, U(1000)),
      };
      await expectRevert(
        gm.write.managedBuy([user1.account.address, 0n, [evilLeg], FOREVER], { account: managerW.account }),
        "OutputBelowMin"
      );
      // Nothing moved: user keeps their USDG, attacker got nothing.
      expect(await bal(usdg, user1.account.address)).to.equal(userBefore);
      expect((await bal(aapl, stranger.account.address)) - attackerBefore).to.equal(0n);
    });

    it("managedRebalance rejects minOut==0 legs and bounds turnover to maxPerBuyUsdg", async () => {
      await buyBasket(user1); // 10 AAPL, 5 TSLA, 4 NVDA
      await gm.write.enableAuto([0n, U(1), U(1), HOUR, 10_000], { account: user1.account });

      // minOut==0 leg is rejected outright.
      await expectRevert(
        gm.write.managedRebalance(
          [user1.account.address, 0n, [legSell(aapl, S(1), 0n), legBuy(tsla, U(10), 1n)], FOREVER],
          { account: managerW.account }
        ),
        "MinOutRequired"
      );

      // With valid minOuts the churn is still bounded: selling 1 AAPL ($10) turns over
      // 10 USDG which exceeds the user's 1-USDG per-action cap.
      await expectRevert(
        gm.write.managedRebalance(
          [user1.account.address, 0n, [legSell(aapl, S(1), U(9)), legBuy(tsla, U(10), 1n)], FOREVER],
          { account: managerW.account }
        ),
        "RebalanceTurnoverCapExceeded"
      );
      // Position untouched by the reverted attempts.
      expect((await position(user1)).costBasis).to.equal(U(300));
      expect(await bal(aapl, user1.account.address)).to.equal(S(10));
    });

    it("managedRebalance within the turnover cap works with proper minOuts", async () => {
      await buyBasket(user1);
      await gm.write.enableAuto([0n, U(100), U(100), HOUR, 10_000], { account: user1.account });
      // Sell 5 AAPL ($10 -> 50 USDG turnover, <= 100 cap), rebuy TSLA.
      await gm.write.managedRebalance(
        [user1.account.address, 0n, [legSell(aapl, S(5), U(50)), legBuy(tsla, U(50), S(5) / 2n)], FOREVER],
        { account: managerW.account }
      );
      const p = await position(user1);
      expect(p.costBasis).to.equal(U(300)); // rebalance never moves basis
      expect(p.map[getAddress(aapl.address)]).to.equal(S(5));
      expect(p.map[getAddress(tsla.address)]).to.equal(S(15) / 2n);
      await expectContractEmpty();
    });
  });

  describe("hardening: dust buys are rejected by the minimum notional", () => {
    it("a 1-unit buy reverts (no activeUserCount inflation) but a 0.25-USDG buy works", async () => {
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, 1n, 1n)], FOREVER], { account: user1.account }),
        "BuyLegTooSmall"
      );
      expect((await groveStats()).users).to.equal(0n); // nothing minted, no user counted
      // The floor is exactly 0.25 USDG: a dust guard, not a business rule. It
      // has to stay low enough that the smallest published weight in a grove
      // still clears it at the app's minimum buy, or a deposit silently buys
      // only part of the basket (the 11-USDG floor did exactly that).
      const floor = await gm.read.MIN_BUY_USDG();
      expect(floor).to.equal(250_000n);
      await expectRevert(
        gm.write.buy([0n, [legBuy(aapl, floor - 1n, 1n)], FOREVER], { account: user1.account }),
        "BuyLegTooSmall"
      );
      await gm.write.buy([0n, [legBuy(aapl, floor, 1n)], FOREVER], { account: user1.account });
      expect((await groveStats()).users).to.equal(1n);
    });

    it("a $20 buy fills every name of an 8-name grove at published weights", async () => {
      // The regression the new floor exists to prevent: at 11 USDG a $20 buy
      // could place at most one leg, so two depositors of different size held
      // different baskets and the manager could never equalize them.
      const weightsBps = [1600n, 1400n, 1300n, 1300n, 1100n, 1100n, 1100n, 1100n];
      const total = U(20);
      const floor = await gm.read.MIN_BUY_USDG();
      // Every published weight clears the floor at the app's $20 minimum.
      for (const bps of weightsBps) {
        expect((total * bps) / 10_000n >= floor).to.equal(true);
      }
      // The old floor is what broke it: at 11 USDG only the top name survived.
      const cleared11 = weightsBps.filter((bps) => (total * bps) / 10_000n >= U(11)).length;
      expect(cleared11).to.equal(0);
    });
  });
});
