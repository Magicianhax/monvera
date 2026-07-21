import hre from "hardhat";
import { expect } from "chai";
import { parseEventLogs } from "viem";

// MonveraStaking + GroveCuratorRegistry suite. Fresh MockERC20 (18dp) per test
// as the stake token. Time travel via evm_increaseTime, matching the
// GroveManager suite's conventions.

const M = (n: number | bigint) => BigInt(n) * 10n ** 18n; // token raw units
const DAY = 24 * 3600;
const COOLDOWN = 7 * DAY;

describe("MonveraStaking", function () {
  this.timeout(120_000);

  let publicClient: any;
  let deployer: any, alice: any, bob: any;
  let token: any, staking: any;

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
    expect(failed, `expected revert${err ? ` with ${err}` : ""}, but the call succeeded`).to.equal(true);
    if (err) expect(msg, "revert reason mismatch").to.include(err);
  }

  async function events(hash: `0x${string}`, eventName: string, abi?: any) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return parseEventLogs({ abi: abi ?? staking.abi, logs: receipt.logs, eventName: eventName as any }) as any[];
  }

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [deployer, alice, bob] = await hre.viem.getWalletClients();
    token = await hre.viem.deployContract("MockERC20", ["Monvera", "MONVERA", 18]);
    staking = await hre.viem.deployContract("MonveraStaking", [token.address, BigInt(COOLDOWN)]);
    for (const w of [alice, bob]) {
      await token.write.mint([w.account.address, M(1_000_000)]);
      await token.write.approve([staking.address, M(1_000_000)], { account: w.account });
    }
  });

  // ---------------------------------------------------------------- deploy

  it("rejects a zero token address and out-of-bounds cooldowns", async () => {
    await expectRevert(
      hre.viem.deployContract("MonveraStaking", ["0x0000000000000000000000000000000000000000", BigInt(COOLDOWN)]),
      "ZeroAddress",
    );
    await expectRevert(hre.viem.deployContract("MonveraStaking", [token.address, 60n]), "BadCooldown");
    await expectRevert(
      hre.viem.deployContract("MonveraStaking", [token.address, BigInt(31 * DAY)]),
      "BadCooldown",
    );
  });

  // ---------------------------------------------------------------- stake

  it("stakes: pulls tokens, credits the account, moves the totals", async () => {
    const hash = await staking.write.stake([M(100_000)], { account: alice.account });
    const [ev] = await events(hash, "Staked");
    expect(ev.args.amount).to.equal(M(100_000));
    expect(ev.args.stakedAfter).to.equal(M(100_000));
    expect(await staking.read.stakedOf([alice.account.address])).to.equal(M(100_000));
    expect(await staking.read.totalStaked()).to.equal(M(100_000));
    expect(await token.read.balanceOf([staking.address])).to.equal(M(100_000));
  });

  it("rejects zero-amount stakes", async () => {
    await expectRevert(staking.write.stake([0n], { account: alice.account }), "ZeroAmount");
  });

  it("keeps accounts isolated", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    await staking.write.stake([M(50)], { account: bob.account });
    expect(await staking.read.stakedOf([alice.account.address])).to.equal(M(100));
    expect(await staking.read.stakedOf([bob.account.address])).to.equal(M(50));
    expect(await staking.read.totalStaked()).to.equal(M(150));
  });

  // ---------------------------------------------------------------- unstake

  it("requestUnstake moves staked -> pending immediately (tiers stop counting)", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    const hash = await staking.write.requestUnstake([M(40)], { account: alice.account });
    const [ev] = await events(hash, "UnstakeRequested");
    expect(ev.args.amount).to.equal(M(40));
    expect(await staking.read.stakedOf([alice.account.address])).to.equal(M(60));
    const [pending] = await staking.read.pendingOf([alice.account.address]);
    expect(pending).to.equal(M(40));
    expect(await staking.read.totalStaked()).to.equal(M(60));
    expect(await staking.read.totalPending()).to.equal(M(40));
  });

  it("cannot request more than staked", async () => {
    await staking.write.stake([M(10)], { account: alice.account });
    await expectRevert(staking.write.requestUnstake([M(11)], { account: alice.account }), "InsufficientStaked");
  });

  it("withdraw before the cooldown reverts; after it, pays out", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    await staking.write.requestUnstake([M(100)], { account: alice.account });
    await expectRevert(staking.write.withdraw({ account: alice.account }), "StillCooling");
    await travel(COOLDOWN + 1);
    const balBefore = await token.read.balanceOf([alice.account.address]);
    const hash = await staking.write.withdraw({ account: alice.account });
    const [ev] = await events(hash, "Withdrawn");
    expect(ev.args.amount).to.equal(M(100));
    const balAfter = await token.read.balanceOf([alice.account.address]);
    expect(balAfter - balBefore).to.equal(M(100));
    expect(await staking.read.totalPending()).to.equal(0n);
  });

  it("a second request RESTARTS the single timer for the whole pending amount", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    await staking.write.requestUnstake([M(50)], { account: alice.account });
    await travel(COOLDOWN - 60); // almost done cooling
    await staking.write.requestUnstake([M(50)], { account: alice.account });
    // old tranche would have unlocked in 60s — the reset means it now hasn't
    await travel(120);
    await expectRevert(staking.write.withdraw({ account: alice.account }), "StillCooling");
    await travel(COOLDOWN);
    await staking.write.withdraw({ account: alice.account });
    expect(await token.read.balanceOf([staking.address])).to.equal(0n);
  });

  it("cancelUnstake returns the pending amount to the stake and clears the timer", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    await staking.write.requestUnstake([M(100)], { account: alice.account });
    const hash = await staking.write.cancelUnstake({ account: alice.account });
    const [ev] = await events(hash, "UnstakeCancelled");
    expect(ev.args.stakedAfter).to.equal(M(100));
    expect(await staking.read.stakedOf([alice.account.address])).to.equal(M(100));
    const [pending, unlockAt] = await staking.read.pendingOf([alice.account.address]);
    expect(pending).to.equal(0n);
    expect(unlockAt).to.equal(0n);
    await expectRevert(staking.write.withdraw({ account: alice.account }), "NothingPending");
  });

  it("withdraw with nothing pending reverts", async () => {
    await expectRevert(staking.write.withdraw({ account: alice.account }), "NothingPending");
  });

  // ---------------------------------------------------------------- invariants

  it("CONTROL: contract balance always equals totalStaked + totalPending through a stress mix", async () => {
    await staking.write.stake([M(500)], { account: alice.account });
    await staking.write.stake([M(300)], { account: bob.account });
    await staking.write.requestUnstake([M(200)], { account: alice.account });
    await staking.write.cancelUnstake({ account: alice.account });
    await staking.write.requestUnstake([M(100)], { account: bob.account });
    await travel(COOLDOWN + 1);
    await staking.write.withdraw({ account: bob.account });
    await staking.write.stake([M(42)], { account: bob.account });
    const bal = await token.read.balanceOf([staking.address]);
    const staked = await staking.read.totalStaked();
    const pending = await staking.read.totalPending();
    expect(bal).to.equal(staked + pending);
    expect(staked).to.equal(M(500) + M(300) - M(100) + M(42));
  });
});

describe("GroveCuratorRegistry", function () {
  this.timeout(120_000);

  let publicClient: any;
  let deployer: any, alice: any, bob: any;
  let token: any, staking: any, registry: any;

  const THRESHOLD = M(500_000);

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
    if (err) expect(msg, "revert reason mismatch").to.include(err);
  }

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [deployer, alice, bob] = await hre.viem.getWalletClients();
    token = await hre.viem.deployContract("MockERC20", ["Monvera", "MONVERA", 18]);
    staking = await hre.viem.deployContract("MonveraStaking", [token.address, BigInt(COOLDOWN)]);
    registry = await hre.viem.deployContract("GroveCuratorRegistry", [staking.address, THRESHOLD]);
    await token.write.mint([alice.account.address, M(1_000_000)]);
    await token.write.approve([staking.address, M(1_000_000)], { account: alice.account });
  });

  it("gates setCurator on the live staked balance", async () => {
    await expectRevert(
      registry.write.setCurator([0n, alice.account.address, 4000]),
      "CuratorNotEligible",
    );
    await staking.write.stake([THRESHOLD], { account: alice.account });
    await registry.write.setCurator([0n, alice.account.address, 4000]);
    const [curator, share] = await registry.read.curatorOf([0n]);
    expect(curator.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(share).to.equal(4000);
  });

  it("caps the share at 50% and rejects zero curators", async () => {
    await staking.write.stake([THRESHOLD], { account: alice.account });
    await expectRevert(registry.write.setCurator([0n, alice.account.address, 5001]), "ShareTooHigh");
    await expectRevert(
      registry.write.setCurator([0n, "0x0000000000000000000000000000000000000000", 4000]),
      "ZeroAddress",
    );
  });

  it("eligibility reads the staking contract live; pending doesn't count", async () => {
    await staking.write.stake([THRESHOLD], { account: alice.account });
    expect(await registry.read.curatorEligible([alice.account.address])).to.equal(true);
    await staking.write.requestUnstake([M(1)], { account: alice.account });
    expect(await registry.read.curatorEligible([alice.account.address])).to.equal(false);
  });

  it("only the owner sets/clears; clear emits the removed curator", async () => {
    await staking.write.stake([THRESHOLD], { account: alice.account });
    await expectRevert(
      registry.write.setCurator([0n, alice.account.address, 4000], { account: bob.account }),
    );
    await registry.write.setCurator([0n, alice.account.address, 4000]);
    await registry.write.clearCurator([0n]);
    const [curator] = await registry.read.curatorOf([0n]);
    expect(curator).to.equal("0x0000000000000000000000000000000000000000");
  });

  it("threshold changes gate future assignments, not existing entries", async () => {
    await staking.write.stake([THRESHOLD], { account: alice.account });
    await registry.write.setCurator([0n, alice.account.address, 4000]);
    await registry.write.setMinCuratorStake([THRESHOLD * 2n]);
    // existing entry survives...
    const [curator] = await registry.read.curatorOf([0n]);
    expect(curator.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    // ...but a new assignment at the old stake fails
    await expectRevert(registry.write.setCurator([1n, alice.account.address, 4000]), "CuratorNotEligible");
  });
});
