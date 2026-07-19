import hre from "hardhat";
import { expect } from "chai";
import { encodeFunctionData, getAddress } from "viem";

// FUND-SAFETY PoC suite for GroveManager — now a REGRESSION suite for the fix.
// The original PoCs proved that managedBuy / managedRebalance enforced spend caps +
// cooldown but NOT per-leg slippage or output recipient, so a malicious/compromised
// manager key could route a whitelisted venue's output to an attacker (minOut == 0,
// out == 0) and drain an opted-in user. The hardened contract requires minOut > 0 on
// every managed leg (the contract forwards only its OWN measured tokenOut delta to
// the user, so a full redirect yields out == 0 and now reverts) and bounds
// managedRebalance turnover to the user's maxPerBuyUsdg. These tests replay the exact
// malicious legs and assert the drain now REVERTS with the user's funds intact.

const FOREVER = 2n ** 200n;
const HOUR = 3600;
const TIMELOCK = 48 * HOUR;
const U = (n: number | bigint) => BigInt(n) * 10n ** 6n; // USDG raw units (6dp)
const S = (n: number | bigint) => BigInt(n) * 10n ** 18n; // stock raw units (18dp)
const buyRate = (price6: bigint) => 10n ** 36n / price6; // usdg(6) -> stock(18)
const sellRate = (price6: bigint) => price6; // stock(18) -> usdg(6)

describe("GroveManager — fund-safety PoCs", function () {
  this.timeout(120_000);

  let publicClient: any;
  let owner: any, user1: any, managerW: any, guardianW: any, treasuryW: any, attacker: any;
  let gm: any, usdg: any, aapl: any, tsla: any, nvda: any;
  let router: any, redirect: any;
  let treasury: `0x${string}`;

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
    if (err) expect(msg, `revert reason mismatch`).to.include(err);
  }

  async function bal(token: any, who: `0x${string}`) {
    return (await token.read.balanceOf([who])) as bigint;
  }

  function swapData(rt: any, tokenIn: string, tokenOut: string, amountIn: bigint) {
    return encodeFunctionData({ abi: rt.abi, functionName: "swap", args: [tokenIn, tokenOut, amountIn] });
  }

  async function whitelistAll(targets: { addr: string; asApproval: boolean }[]) {
    for (const t of targets) await gm.write.proposeSwapTarget([t.addr, t.asApproval]);
    await travel(TIMELOCK + 1);
    for (const t of targets) await gm.write.applySwapTarget([t.addr, t.asApproval]);
  }

  beforeEach(async () => {
    publicClient = await hre.viem.getPublicClient();
    [owner, user1, managerW, guardianW, treasuryW, attacker] = await hre.viem.getWalletClients();
    treasury = treasuryW.account.address;

    usdg = await hre.viem.deployContract("MockERC20", ["USDG", "USDG", 6]);
    aapl = await hre.viem.deployContract("MockERC20", ["Apple", "AAPL", 18]);
    tsla = await hre.viem.deployContract("MockERC20", ["Tesla", "TSLA", 18]);
    nvda = await hre.viem.deployContract("MockERC20", ["Nvidia", "NVDA", 18]);
    router = await hre.viem.deployContract("MockSwapRouter", []);
    redirect = await hre.viem.deployContract("MockRedirectRouter", []);

    gm = await hre.viem.deployContract("GroveManager", [usdg.address, treasury]);
    await gm.write.setManager([managerW.account.address]);
    await gm.write.setGuardian([guardianW.account.address]);
    await whitelistAll([
      { addr: router.address, asApproval: false },
      { addr: router.address, asApproval: true },
      { addr: redirect.address, asApproval: false },
      { addr: redirect.address, asApproval: true },
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

    // Prices on the honest router.
    await router.write.setRate([usdg.address, aapl.address, buyRate(U(10))]);
    await router.write.setRate([aapl.address, usdg.address, sellRate(U(10))]);
    await router.write.setRate([usdg.address, tsla.address, buyRate(U(20))]);
    await router.write.setRate([tsla.address, usdg.address, sellRate(U(20))]);
    // Same fair rate on the redirect router (so the "value" is real, only the recipient is wrong).
    await redirect.write.setRate([usdg.address, aapl.address, buyRate(U(10))]);
    await redirect.write.setRecipient([attacker.account.address]);

    await usdg.write.mint([user1.account.address, U(10_000)]);
    await usdg.write.approve([gm.address, 2n ** 255n], { account: user1.account });
    for (const t of [aapl, tsla, nvda]) {
      await t.write.approve([gm.address, 2n ** 255n], { account: user1.account });
    }
  });

  it("PoC-1 (fixed): the managedBuy redirect drain now REVERTS; the user's USDG stays put", async () => {
    // User opts in with a generous budget and the minimum 1h cooldown.
    await gm.write.enableAuto([0n, U(1000), U(5000), HOUR], { account: user1.account });

    const userUsdgBefore = await bal(usdg, user1.account.address);
    const attackerAaplBefore = await bal(aapl, attacker.account.address);

    // Exactly the leg a compromised Vera ops key would submit: a real whitelisted
    // venue (redirect) with the swap output going to the attacker. minOut = 0 is
    // what makes out == 0 pass on the unpatched contract.
    const evilLeg = {
      tokenIn: usdg.address,
      tokenOut: aapl.address,
      amountIn: U(1000),
      minOut: 0n,
      callTarget: redirect.address,
      approvalTarget: redirect.address,
      data: swapData(redirect, usdg.address, aapl.address, U(1000)),
    };

    // Hardened contract: managed legs must carry minOut > 0, so this reverts before
    // any funds move.
    await expectRevert(
      gm.write.managedBuy([user1.account.address, 0n, [evilLeg], FOREVER], { account: managerW.account }),
      "ManagerMinOutRequired"
    );

    // Even if the manager sets a token minOut (1 wei) to dodge that check, the
    // contract's own tokenOut delta is still 0 on a full redirect -> OutputBelowMin.
    await expectRevert(
      gm.write.managedBuy(
        [user1.account.address, 0n, [{ ...evilLeg, minOut: 1n }], FOREVER],
        { account: managerW.account }
      ),
      "OutputBelowMin"
    );

    // Nothing moved: user keeps every USDG, attacker got nothing, no phantom basis.
    expect(await bal(usdg, user1.account.address)).to.equal(userUsdgBefore);
    expect((await bal(aapl, attacker.account.address)) - attackerAaplBefore).to.equal(0n);
    expect(await bal(usdg, gm.address)).to.equal(0n);
    const [costBasis] = await gm.read.positionOf([user1.account.address, 0n]);
    expect(costBasis).to.equal(0n);
  });

  it("PoC-2 (fixed): managedRebalance can no longer churn the whole position out to an attacker", async () => {
    // Honest buy first (through the honest router): user gets 100 AAPL for 1000 USDG.
    await router.write.setRate([usdg.address, aapl.address, buyRate(U(10))]);
    await gm.write.buy(
      [0n, [{
        tokenIn: usdg.address, tokenOut: aapl.address, amountIn: U(1000), minOut: S(100),
        callTarget: router.address, approvalTarget: router.address,
        data: swapData(router, usdg.address, aapl.address, U(1000)),
      }], FOREVER],
      { account: user1.account }
    );
    expect(await bal(aapl, user1.account.address)).to.equal(S(100));

    // User opts into auto with a TIGHT total cap (only 1 USDG of manager BUY budget).
    await gm.write.enableAuto([0n, U(1), U(1), HOUR], { account: user1.account });

    // The original exploit: sell the user's AAPL for USDG on the honest router (into
    // the transient pool), then "buy" it back through the redirect venue with
    // minOut=0 so the re-bought stock lands at the attacker.
    await redirect.write.setRecipient([attacker.account.address]);

    const attackerBefore = await bal(aapl, attacker.account.address);
    const rebLegs = [
      { // sell 100 AAPL -> 1000 USDG into the pool (honest router)
        tokenIn: aapl.address, tokenOut: usdg.address, amountIn: S(100), minOut: 0n,
        callTarget: router.address, approvalTarget: router.address,
        data: swapData(router, aapl.address, usdg.address, S(100)),
      },
      { // "buy" 100 AAPL with the 1000 USDG pool, output redirected to attacker
        tokenIn: usdg.address, tokenOut: aapl.address, amountIn: U(1000), minOut: 0n,
        callTarget: redirect.address, approvalTarget: redirect.address,
        data: swapData(redirect, usdg.address, aapl.address, U(1000)),
      },
    ];

    // Hardened contract: managed rebalance legs must carry minOut > 0, so the
    // minOut=0 legs revert before anything executes.
    await expectRevert(
      gm.write.managedRebalance([user1.account.address, 0n, rebLegs, FOREVER], { account: managerW.account }),
      "ManagerMinOutRequired"
    );

    // And even if the manager sets a token minOut (1 wei) to dodge that check, the
    // redirect buy leg delivers out == 0 to the contract, so the contract's own
    // tokenOut delta check reverts (OutputBelowMin) — the value can never leave.
    const rebLegsFloored = [
      { ...rebLegs[0], minOut: 1n },
      { ...rebLegs[1], minOut: 1n },
    ];
    await expectRevert(
      gm.write.managedRebalance([user1.account.address, 0n, rebLegsFloored, FOREVER], { account: managerW.account }),
      "OutputBelowMin"
    );

    // The user still holds all 100 AAPL, the attacker got nothing, basis intact.
    expect(await bal(aapl, user1.account.address)).to.equal(S(100));
    expect((await bal(aapl, attacker.account.address)) - attackerBefore).to.equal(0n);
    expect(await bal(usdg, gm.address)).to.equal(0n);
    const [costBasis] = await gm.read.positionOf([user1.account.address, 0n]);
    expect(costBasis).to.equal(U(1000));
  });
});
