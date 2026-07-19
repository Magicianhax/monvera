import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData, getAddress, parseEventLogs } from "viem";

// ACCOUNTING + FEE-MATH adversarial PoC suite for GroveManager — now a REGRESSION
// suite for the fix. The original PoCs probed pooled-basis front-loading (withdraw
// 100% of pooled basis against a sale of only the winner, abandoning the flats
// fee-free) and dust-count inflation (1-unit buys minting activeUserCount++). The
// hardened contract requires a fractionBps==10000 exit to liquidate every tracked
// token to zero, and enforces an 11-USDG minimum notional per buy leg. These tests
// replay the exploits and assert they revert, plus keep the aggregate-invariant edge.

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const BPS = 10_000n;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const buyRate = (price6: bigint) => 10n ** 36n / price6;
const sellRate = (price6: bigint) => price6;

describe("GroveManager — accounting/fee PoC", function () {
  this.timeout(120_000);

  let publicClient: any;
  let owner: any, user1: any, user2: any, managerW: any, guardianW: any, treasuryW: any, stranger: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any, goog: any;
  let router: any, router2: any, puller: any;
  let treasury: `0x${string}`;

  async function travel(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
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
  }
  async function groveStats(id = 0n) {
    const g = await gm.read.groves([id]);
    return { users: g[3] as bigint, basis: g[4] as bigint, inflow: g[5] as bigint, proceeds: g[6] as bigint, fees: g[7] as bigint };
  }
  async function position(user: any, id = 0n) {
    const [costBasis, tokens, amounts] = await gm.read.positionOf([user.account.address, id]);
    const map: Record<string, bigint> = {};
    (tokens as string[]).forEach((t, i) => (map[getAddress(t)] = (amounts as bigint[])[i]));
    return { costBasis: costBasis as bigint, map };
  }
  async function bal(token: any, who: `0x${string}`) { return (await token.read.balanceOf([who])) as bigint; }
  async function whitelistAll(targets: { addr: string; asApproval: boolean }[]) {
    for (const t of targets) await gm.write.proposeSwapTarget([t.addr, t.asApproval]);
    await travel(TIMELOCK + 1);
    for (const t of targets) await gm.write.applySwapTarget([t.addr, t.asApproval]);
  }

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [owner, user1, user2, managerW, guardianW, treasuryW, stranger] = await hre.viem.getWalletClients();
    treasury = treasuryW.account.address;

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
      [ { token: aapl.address, weightBps: 4000 }, { token: tsla.address, weightBps: 3000 }, { token: nvda.address, weightBps: 3000 } ],
    ]);
    await setPrice(aapl, U(10));
    await setPrice(tsla, U(20));
    await setPrice(nvda, U(25));
    for (const u of [user1, user2]) {
      await usdg.write.mint([u.account.address, U(10_000)]);
      await usdg.write.approve([gm.address, 2n ** 255n], { account: u.account });
      for (const t of [aapl, tsla, nvda, goog]) await t.write.approve([gm.address, 2n ** 255n], { account: u.account });
    }
  });

  // ------------------------------------------------------------------ FINDING 1
  // Pooled-basis front-loading: withdraw 100% of pooled cost basis against a sale
  // of ONLY the appreciated token, then abandon the flat tokens. The 10%-of-profit
  // fee on a genuine, in-contract-realized profit is HALVED vs the honest exit.
  it("FINDING 1 (fixed): front-loading pooled basis onto the winner now reverts; honest liquidation pays 40", async () => {
    // Buy an equal-basis basket: 100 USDG into each of AAPL/TSLA/NVDA (basis 300).
    await gm.write.buy([0n, [legBuy(aapl, U(100), 0n), legBuy(tsla, U(100), 0n), legBuy(nvda, U(100), 0n)], FOREVER], { account: user1.account });
    // AAPL moons 5x ($10 -> $50); TSLA & NVDA stay flat (at their cost).
    await setPrice(aapl, U(50));
    // Holdings: 10 AAPL (now $500), 5 TSLA ($100), 4 NVDA ($100). Total value 700, basis 300.

    const treasuryBefore = await bal(usdg, treasury);
    // ATTACK: sell ONLY the 10 AAPL but withdraw 100% of pooled basis (fractionBps 10000),
    // abandoning TSLA/NVDA fee-free. Hardened contract requires a full liquidation ->
    // reverts because TSLA and NVDA are still held.
    await expectRevert(
      gm.write.exit([0n, [legSell(aapl, S(10), 0n)], 10000, FOREVER], { account: user1.account }),
      "IncompleteFullExit"
    );
    // Nothing happened.
    expect((await bal(usdg, treasury)) - treasuryBefore).to.equal(0n);
    expect((await position(user1)).costBasis).to.equal(U(300));
    expect((await groveStats()).users).to.equal(1n);

    // The only accepted 10000 exit is the honest full liquidation: sell everything,
    // proceeds 700, basisWithdrawn 300, fee = 10% * 400 = 40.
    const hash = await gm.write.exit(
      [0n, [legSell(aapl, S(10), 0n), legSell(tsla, S(5), 0n), legSell(nvda, S(4), 0n)], 10000, FOREVER],
      { account: user1.account }
    );
    const ev = (await events(hash, "Exited"))[0];
    expect(ev.args.proceedsUsdg).to.equal(U(700));
    expect((await bal(usdg, treasury)) - treasuryBefore).to.equal(U(40));
    expect((await position(user1)).costBasis).to.equal(0n);
    expect((await groveStats()).users).to.equal(0n);
  });

  // ------------------------------------------------------------------ FINDING 1b
  // Extreme form: drive the in-contract profit fee to ZERO while selling a winner,
  // by keeping that exit's proceeds <= pooled basis (return-of-capital framing).
  it("FINDING 1b (fixed): the ZERO-fee full-basis-on-a-partial-sale variant also reverts", async () => {
    await gm.write.buy([0n, [legBuy(aapl, U(100), 0n), legBuy(tsla, U(100), 0n), legBuy(nvda, U(100), 0n)], FOREVER], { account: user1.account });
    await setPrice(aapl, U(30)); // AAPL 3x -> 10 AAPL worth $300 == pooled basis
    const treasuryBefore = await bal(usdg, treasury);
    // Sell all 10 AAPL for exactly $300 with fractionBps 10000 while keeping TSLA/NVDA:
    // on the unpatched contract proceeds 300 == basisWithdrawn 300 -> fee 0. Now the
    // full-liquidation requirement rejects it (TSLA/NVDA still held).
    await expectRevert(
      gm.write.exit([0n, [legSell(aapl, S(10), 0n)], 10000, FOREVER], { account: user1.account }),
      "IncompleteFullExit"
    );
    expect((await bal(usdg, treasury)) - treasuryBefore).to.equal(0n);
    // Position untouched; the user still holds everything they bought.
    expect((await position(user1)).costBasis).to.equal(U(300));
    expect(await bal(tsla, user1.account.address)).to.equal(S(5));
    expect(await bal(nvda, user1.account.address)).to.equal(S(4));
  });

  // ------------------------------------------------------------------ FINDING 2
  // No minimum notional: a 1-unit (0.000001 USDG) buy from a fresh address mints a
  // full activeUserCount++ — a public tracker metric (DefiLlama etc.) is Sybil-inflatable
  // for ~dust + gas, with no economic floor in the contract.
  it("FINDING 2 (fixed): dust (1-unit) buys revert on the minimum notional — no count inflation", async () => {
    await setPrice(aapl, U(10));
    // A 1-raw-unit buy (0.000001 USDG) is now rejected by the 11-USDG floor.
    await expectRevert(
      gm.write.buy([0n, [legBuy(aapl, 1n, 0n)], FOREVER], { account: user1.account }),
      "BuyLegTooSmall"
    );
    await expectRevert(
      gm.write.buy([0n, [legBuy(aapl, 1n, 0n)], FOREVER], { account: user2.account }),
      "BuyLegTooSmall"
    );
    const g = await groveStats();
    expect(g.users).to.equal(0n); // no phantom "active users"
    expect(g.basis).to.equal(0n);
    // A real buy at the floor works and counts exactly once.
    await gm.write.buy([0n, [legBuy(aapl, U(11), 0n)], FOREVER], { account: user1.account });
    expect((await groveStats()).users).to.equal(1n);
  });

  // ------------------------------------------------------------------ CONTROL A
  // Confirm totalCostBasis never drifts from the sum of per-user basis across a
  // stress sequence of dust + partial + front-load + close, and activeUserCount
  // never underflows.
  it("CONTROL: totalCostBasis == sum(per-user basis) and count is exact through stress", async () => {
    // u1 full basket (300), u2 aapl-only (100 -> but at $10 = 10 sh)
    await gm.write.buy([0n, [legBuy(aapl, U(100), 0n), legBuy(tsla, U(100), 0n), legBuy(nvda, U(100), 0n)], FOREVER], { account: user1.account });
    await gm.write.buy([0n, [legBuy(aapl, U(100), 0n)], FOREVER], { account: user2.account });
    // u1 partial exit 30% (partial exits may still sell a subset; basis is retained)
    await setPrice(aapl, U(20));
    await gm.write.exit([0n, [legSell(aapl, S(3), 0n)], 3000, FOREVER], { account: user1.account });
    // u2 full exit — under the fix a 10000 exit must liquidate the whole position, so
    // u2 sells all 10 AAPL (their only holding).
    await gm.write.exit([0n, [legSell(aapl, S(10), 0n)], 10000, FOREVER], { account: user2.account });

    const p1 = (await position(user1)).costBasis;
    const p2 = (await position(user2)).costBasis;
    const g = await groveStats();
    expect(g.basis).to.equal(p1 + p2); // aggregate == sum of survivors
    expect(g.users).to.equal(p2 === 0n ? 1n : 2n);
    // u1 closes -> everything zero, no underflow
    await gm.write.closePosition([0n], { account: user1.account });
    const g2 = await groveStats();
    expect(g2.basis).to.equal(0n);
    expect(g2.users).to.equal(0n);
  });
});
