import hre from "hardhat";
import { expect } from "chai";
import { encodePacked, keccak256 } from "viem";

// SeasonDistributor + the staking weight accumulator. The merkle tree here is
// built by hand (sorted-pair hashing, matching OpenZeppelin's MerkleProof).

const M = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const DAY = 24 * 3600;
const COOLDOWN = 7 * DAY;

function leafOf(seasonId: bigint, account: `0x${string}`, amount: bigint): `0x${string}` {
  return keccak256(encodePacked(["uint256", "address", "uint256"], [seasonId, account, amount]));
}

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(encodePacked(["bytes32", "bytes32"], [lo, hi]));
}

describe("MonveraStaking weight accumulator", function () {
  this.timeout(120_000);

  let alice: any, bob: any;
  let token: any, staking: any;

  async function travel(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    [, alice, bob] = await hre.viem.getWalletClients();
    token = await hre.viem.deployContract("MockERC20", ["Monvera", "MONVERA", 18]);
    staking = await hre.viem.deployContract("MonveraStaking", [token.address, BigInt(COOLDOWN)]);
    for (const w of [alice, bob]) {
      await token.write.mint([w.account.address, M(1_000_000)]);
      await token.write.approve([staking.address, M(1_000_000)], { account: w.account });
    }
  });

  it("weight integrates staked balance over time; pending earns nothing", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    await travel(1000);
    const w1 = await staking.read.weightOf([alice.account.address]);
    // ~100e18 * 1000s, allow a few seconds of block-time slop
    expect(w1 >= M(100) * 1000n && w1 <= M(100) * 1010n).to.equal(true);

    // Move half to pending: only the still-staked half accrues from here.
    await staking.write.requestUnstake([M(50)], { account: alice.account });
    const w2 = await staking.read.weightOf([alice.account.address]);
    await travel(1000);
    const w3 = await staking.read.weightOf([alice.account.address]);
    const delta = w3 - w2;
    expect(delta >= M(50) * 1000n && delta <= M(50) * 1010n).to.equal(true);
  });

  it("totalWeight equals the sum of user weights through a mixed history", async () => {
    await staking.write.stake([M(100)], { account: alice.account });
    await travel(500);
    await staking.write.stake([M(300)], { account: bob.account });
    await travel(500);
    await staking.write.requestUnstake([M(100)], { account: alice.account });
    await travel(500);
    await staking.write.cancelUnstake({ account: alice.account });
    await travel(500);
    const wa = await staking.read.weightOf([alice.account.address]);
    const wb = await staking.read.weightOf([bob.account.address]);
    const wt = await staking.read.totalWeight();
    // Same-block reads: totals must reconcile exactly up to the accrual
    // boundary of the latest state-changing txs; allow tiny slop from the
    // seconds between the three view calls landing on the same block.
    const diff = wt > wa + wb ? wt - (wa + wb) : wa + wb - wt;
    expect(diff <= M(400) * 5n).to.equal(true); // ≤ ~5s of drift at max stake
  });
});

describe("SeasonDistributor", function () {
  this.timeout(120_000);

  let publicClient: any;
  let deployer: any, alice: any, bob: any, carol: any;
  let token: any, dist: any;

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

  async function chainNow(): Promise<bigint> {
    const block = await publicClient.getBlock();
    return block.timestamp;
  }

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [deployer, alice, bob, carol] = await hre.viem.getWalletClients();
    token = await hre.viem.deployContract("MockERC20", ["Monvera", "MONVERA", 18]);
    dist = await hre.viem.deployContract("SeasonDistributor", [token.address]);
    await token.write.mint([deployer.account.address, M(10_000_000)]);
    await token.write.approve([dist.address, M(10_000_000)]);
  });

  function twoLeafTree(seasonId: bigint, a: `0x${string}`, amtA: bigint, b: `0x${string}`, amtB: bigint) {
    const leafA = leafOf(seasonId, a, amtA);
    const leafB = leafOf(seasonId, b, amtB);
    const root = hashPair(leafA, leafB);
    return { root, proofA: [leafB], proofB: [leafA] };
  }

  it("opens a season (pulls the pool), pays valid claims exactly once", async () => {
    const seasonId = 0n;
    const amtA = M(6_000_000);
    const amtB = M(4_000_000);
    const { root, proofA, proofB } = twoLeafTree(
      seasonId, alice.account.address, amtA, bob.account.address, amtB,
    );
    const deadline = (await chainNow()) + BigInt(90 * DAY);
    await dist.write.openSeason([root, M(10_000_000), deadline]);
    expect(await token.read.balanceOf([dist.address])).to.equal(M(10_000_000));

    await dist.write.claim([seasonId, alice.account.address, amtA, proofA], { account: carol.account });
    expect(await token.read.balanceOf([alice.account.address])).to.equal(amtA);
    await expectRevert(
      dist.write.claim([seasonId, alice.account.address, amtA, proofA]),
      "AlreadyClaimed",
    );
    await dist.write.claim([seasonId, bob.account.address, amtB, proofB]);
    expect(await token.read.balanceOf([dist.address])).to.equal(0n);
  });

  it("rejects wrong amounts, wrong proofs, unknown seasons, short windows", async () => {
    const seasonId = 0n;
    const { root, proofA } = twoLeafTree(
      seasonId, alice.account.address, M(1), bob.account.address, M(2),
    );
    await expectRevert(
      dist.write.openSeason([root, M(3), (await chainNow()) + BigInt(DAY)]),
      "BadDeadline",
    );
    const deadline = (await chainNow()) + BigInt(90 * DAY);
    await dist.write.openSeason([root, M(3), deadline]);
    await expectRevert(
      dist.write.claim([seasonId, alice.account.address, M(2), proofA]),
      "InvalidProof",
    );
    await expectRevert(dist.write.claim([1n, alice.account.address, M(1), proofA]), "SeasonUnknown");
  });

  it("sweep only after the deadline, only the season's remainder; open windows are untouchable", async () => {
    const s0 = 0n;
    const t0 = twoLeafTree(s0, alice.account.address, M(10), bob.account.address, M(20));
    const deadline0 = (await chainNow()) + BigInt(31 * DAY);
    await dist.write.openSeason([t0.root, M(30), deadline0]);
    // season 1 with a much later window
    const s1 = 1n;
    const t1 = twoLeafTree(s1, alice.account.address, M(5), bob.account.address, M(5));
    await dist.write.openSeason([t1.root, M(10), (await chainNow()) + BigInt(120 * DAY)]);

    await expectRevert(dist.write.sweep([s0]), "WindowStillOpen");
    await dist.write.claim([s0, alice.account.address, M(10), t0.proofA]);
    await travel(32 * DAY);
    const balBefore = await token.read.balanceOf([deployer.account.address]);
    await dist.write.sweep([s0]);
    const balAfter = await token.read.balanceOf([deployer.account.address]);
    expect(balAfter - balBefore).to.equal(M(20)); // only s0's remainder
    // season 1's pool remains intact and claimable
    await dist.write.claim([s1, bob.account.address, M(5), t1.proofB]);
    expect(await token.read.balanceOf([bob.account.address])).to.equal(M(5));
    // double sweep pays nothing more
    await dist.write.sweep([s0]);
    expect(await token.read.balanceOf([deployer.account.address])).to.equal(balAfter);
  });

  it("only the owner opens seasons and sweeps", async () => {
    const { root } = twoLeafTree(0n, alice.account.address, M(1), bob.account.address, M(1));
    const deadline = (await chainNow()) + BigInt(90 * DAY);
    await expectRevert(dist.write.openSeason([root, M(2), deadline], { account: alice.account }));
    await dist.write.openSeason([root, M(2), deadline]);
    await expectRevert(dist.write.sweep([0n], { account: alice.account }));
  });

  it("renounceOwnership is disabled — ownership can never drop to address(0)", async () => {
    await expectRevert(dist.write.renounceOwnership(), "RenounceDisabled");
    // …but it can still be transferred (two-step) to a new owner.
    await dist.write.transferOwnership([alice.account.address]);
    await dist.write.acceptOwnership({ account: alice.account });
    expect((await dist.read.owner()).toLowerCase()).to.equal(alice.account.address.toLowerCase());
    // and the new owner also cannot renounce.
    await expectRevert(dist.write.renounceOwnership({ account: alice.account }), "RenounceDisabled");
  });
});
