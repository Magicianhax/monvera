import hre from "hardhat";
import { expect } from "chai";

// `bootstrap` is the one path that writes the venue whitelist and price feeds
// WITHOUT the 48h timelock, so its guard is the whole security argument for it
// existing. The claim being tested: it is usable only inside a short window
// that opens at deployment and then closes permanently, and everything it
// writes passes exactly the same validation as the timelocked path.
//
// If any of these fail, the timelock is bypassable and the contract should not
// ship.

const HOUR = 3600;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;

describe("GroveManager — bootstrap window", function () {
  this.timeout(120_000);

  let owner: any, other: any, treasuryW: any;
  let gm: any, usdg: any, aapl: any, router: any, agg: any, deadAgg: any;

  async function travel(seconds: number) {
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

  beforeEach(async () => {
    [owner, other, treasuryW] = await hre.viem.getWalletClients();
    usdg = await hre.viem.deployContract("MockERC20", ["USDG", "USDG", 6]);
    aapl = await hre.viem.deployContract("MockERC20", ["Apple", "AAPL", 18]);
    router = await hre.viem.deployContract("MockSwapRouter", []);
    agg = await hre.viem.deployContract("MockAggregator", [8, U(10) * 100n]);
    deadAgg = await hre.viem.deployContract("MockAggregator", [8, U(10) * 100n]);
    gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasuryW.account.address]);
  });

  it("seeds venues and feeds immediately, with no timelock", async () => {
    expect(await gm.read.callTargetAllowed([router.address])).to.equal(false);

    await gm.write.bootstrap([[router.address], [router.address], [aapl.address], [agg.address], [86400]]);

    expect(await gm.read.callTargetAllowed([router.address])).to.equal(true);
    expect(await gm.read.approvalTargetAllowed([router.address])).to.equal(true);
    const f = await gm.read.feedOf([aapl.address]);
    expect(f[0].toLowerCase()).to.equal(agg.address.toLowerCase());
    expect(Number(f[1])).to.equal(86400);
    // 18dp token + 8dp feed - 6dp USDG
    expect(Number(f[2])).to.equal(20);
  });

  it("closes permanently once the window passes", async () => {
    const deadline = Number(await gm.read.bootstrapDeadline());
    const windowSecs = Number(await gm.read.BOOTSTRAP_WINDOW());
    expect(windowSecs).to.equal(2 * HOUR);

    await travel(windowSecs + 60);
    await expectRevert(
      gm.write.bootstrap([[router.address], [], [], [], []]),
      "BootstrapClosed",
    );
    expect(await gm.read.callTargetAllowed([router.address])).to.equal(false);

    // And it stays shut — this is the property that makes a later owner
    // compromise unable to reach it.
    await travel(365 * 24 * HOUR);
    await expectRevert(gm.write.bootstrap([[router.address], [], [], [], []]), "BootstrapClosed");
    expect(Number(await gm.read.bootstrapDeadline())).to.equal(deadline);
  });

  it("is callable more than once inside the window, so a partial seed can be finished", async () => {
    await gm.write.bootstrap([[router.address], [], [], [], []]);
    await travel(30 * 60);
    await gm.write.bootstrap([[], [router.address], [aapl.address], [agg.address], [86400]]);

    expect(await gm.read.callTargetAllowed([router.address])).to.equal(true);
    expect(await gm.read.approvalTargetAllowed([router.address])).to.equal(true);
    expect((await gm.read.feedOf([aapl.address]))[0].toLowerCase()).to.equal(agg.address.toLowerCase());
  });

  it("is owner-only", async () => {
    const asOther = await hre.viem.getContractAt("GroveManager", gm.address, { client: { wallet: other } });
    await expectRevert(
      asOther.write.bootstrap([[router.address], [], [], [], []]),
      "OwnableUnauthorizedAccount",
    );
  });

  it("applies the same feed validation as the timelocked path", async () => {
    // zero heartbeat
    await expectRevert(gm.write.bootstrap([[], [], [aapl.address], [agg.address], [0]]), "BadFeed");
    // zero aggregator
    await expectRevert(
      gm.write.bootstrap([[], [], [aapl.address], ["0x0000000000000000000000000000000000000000"], [86400]]),
      "BadFeed",
    );
    // an aggregator that does not answer is a dead address
    await deadAgg.write.setReverts([true]);
    await expectRevert(gm.write.bootstrap([[], [], [aapl.address], [deadAgg.address], [86400]]), "BadFeed");
    // nothing partial was written
    expect((await gm.read.feedOf([aapl.address]))[0]).to.equal("0x0000000000000000000000000000000000000000");
  });

  it("rejects zero addresses and mismatched feed array lengths", async () => {
    const ZERO = "0x0000000000000000000000000000000000000000";
    await expectRevert(gm.write.bootstrap([[ZERO], [], [], [], []]), "ZeroAddress");
    await expectRevert(gm.write.bootstrap([[], [ZERO], [], [], []]), "ZeroAddress");
    await expectRevert(gm.write.bootstrap([[], [], [aapl.address], [agg.address], []]), "BadFeed");
    await expectRevert(gm.write.bootstrap([[], [], [aapl.address], [], [86400]]), "BadFeed");
  });

  it("does not weaken the timelock for anything added later", async () => {
    await gm.write.bootstrap([[router.address], [router.address], [], [], []]);
    await travel(3 * HOUR); // window shut

    // A second venue still has to wait the full 48h.
    const other2 = aapl.address;
    await gm.write.proposeSwapTarget([other2, false]);
    await expectRevert(gm.write.applySwapTarget([other2, false]), "TimelockPending");
    expect(await gm.read.callTargetAllowed([other2])).to.equal(false);

    await travel(48 * HOUR + 60);
    await gm.write.applySwapTarget([other2, false]);
    expect(await gm.read.callTargetAllowed([other2])).to.equal(true);
  });
});
