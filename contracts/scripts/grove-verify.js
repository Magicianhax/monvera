const hre = require("hardhat");
const { robinhood, GROVE_MANAGER, FEED_HEARTBEAT, VENUES, USDG, TREASURY } = require("./lib/constants");
const { readGroveRegistry } = require("./lib/registry");

// Prove the chain is in the state the product expects. Read-only — safe any time.
//
// The web renders web/src/lib/groves.ts; the contract executes what was written
// on-chain. Nothing keeps those in step automatically, and a build-time check
// cannot read the chain. This is that check. It exits non-zero on any drift, so
// it can gate a deploy.
//
// It catches the 2026-07-27 class of bug directly: a grove created from a
// composition that matched no registry entry, silently rendered under another
// grove's name.
//
//   npx hardhat run scripts/grove-verify.js --network robinhood

const ZERO = "0x0000000000000000000000000000000000000000";

/** The app's mirror of the contract's dust floor, read as text rather than
 *  imported: groveQuote.ts is "server-only" and pulls the whole venue stack in,
 *  which a keyless verify run must not need. null when it cannot be found. */
function readAppMinBuyUsdg() {
  try {
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../web/src/lib/server/groveQuote.ts"),
      "utf8",
    );
    const m = /MIN_BUY_USDG\s*=\s*BigInt\(\s*([\d_]+)\s*\)/.exec(src);
    return m ? m[1].replace(/_/g, "") : null;
  } catch {
    return null;
  }
}
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const AGG_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
];

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });

  // Bind the ABI straight to the public client rather than going through
  // hre.viem.getContractAt, which wants a wallet. Verification must run with no
  // private key present — it is the check you want to be able to run anywhere.
  const { abi } = await hre.artifacts.readArtifact("GroveManager");
  const gm = {
    read: new Proxy(
      {},
      {
        get:
          (_, functionName) =>
          (args = []) =>
            publicClient.readContract({ address: GROVE_MANAGER, abi, functionName, args }),
      },
    ),
  };

  const problems = [];
  const warnings = [];
  const now = Math.floor(Date.now() / 1000);
  const bad = (m) => problems.push(m);
  const warn = (m) => warnings.push(m);

  console.log(`\nGroveManager ${GROVE_MANAGER}`);

  // ── immutables ────────────────────────────────────────────────────────────
  const [onUsdg, onTreasury, owner, manager, guardian, paused, bandBps, staleBandBps, count, minBuy] =
    await Promise.all([
      gm.read.usdg(),
      gm.read.treasury(),
      gm.read.owner(),
      gm.read.manager(),
      gm.read.guardian(),
      gm.read.paused(),
      gm.read.bandBps(),
      gm.read.staleBandBps(),
      gm.read.groveCount(),
      gm.read.MIN_BUY_USDG(),
    ]);
  console.log(`usdg      ${onUsdg}`);
  console.log(`treasury  ${onTreasury}`);
  console.log(`owner     ${owner}`);
  console.log(`manager   ${manager}`);
  console.log(`guardian  ${guardian}`);
  console.log(`paused    ${paused}   bands ${bandBps}/${staleBandBps} bps   groveCount ${count}\n`);

  if (!same(onUsdg, USDG)) bad(`usdg ${onUsdg} != ${USDG}`);
  if (!same(onTreasury, TREASURY)) bad(`treasury ${onTreasury} != ${TREASURY} — fees would go to the wrong wallet`);
  if (guardian === ZERO) warn("guardian unset — nobody can pause");
  if (manager === ZERO) warn("manager unset — auto-manage is inert");
  if (same(guardian, owner) && guardian !== ZERO) bad("guardian == owner — the pause role is meaningless");
  if (same(manager, owner) && manager !== ZERO) bad("manager == owner — a hot key holds every owner power");
  if (paused) warn("contract is PAUSED — no buys or rebalances");

  // The app sizes every leg against its own mirror of this constant. If the two
  // disagree the failure is total and silent until a user tries to buy: legs
  // sized under the deployed floor revert BuyLegTooSmall and the whole atomic
  // buy dies. Deploying the app ahead of the contract is exactly how that
  // happens, so it is checked here rather than trusted.
  const appFloor = readAppMinBuyUsdg();
  console.log(`MIN_BUY_USDG  ${minBuy} on chain / ${appFloor} in the app`);
  if (appFloor === null) {
    warn("could not read MIN_BUY_USDG from web/src/lib/server/groveQuote.ts");
  } else if (BigInt(appFloor) !== BigInt(minBuy)) {
    bad(
      `MIN_BUY_USDG ${minBuy} on chain != ${appFloor} in the app — every buy whose smallest ` +
        `leg falls between the two reverts BuyLegTooSmall. Deploy the contract first, then the app.`,
    );
  }

  // ── venues ────────────────────────────────────────────────────────────────
  console.log("venues");
  for (const v of VENUES) {
    const live = v.asApproval
      ? await gm.read.approvalTargetAllowed([v.addr])
      : await gm.read.callTargetAllowed([v.addr]);
    const eta = Number(
      v.asApproval ? await gm.read.pendingApprovalTargetEta([v.addr]) : await gm.read.pendingCallTargetEta([v.addr]),
    );
    const state = live ? "LIVE" : eta === 0 ? "MISSING" : eta > now ? `PENDING ${((eta - now) / 3600).toFixed(1)}h` : "MATURE";
    console.log(`  ${state.padEnd(16)} ${v.label}`);
    if (!live) warn(`venue not live: ${v.label} (${state})`);
  }

  // ── groves ────────────────────────────────────────────────────────────────
  const registry = readGroveRegistry();
  const claimed = new Map();

  for (const def of registry) {
    if (def.onChainId === undefined) {
      console.log(`\n${def.id} — preview only (no onChainId)`);
      continue;
    }
    console.log(`\n${def.id} -> grove ${def.onChainId}`);

    if (claimed.has(def.onChainId)) {
      bad(`groveId ${def.onChainId} claimed by both "${claimed.get(def.onChainId)}" and "${def.id}"`);
    }
    claimed.set(def.onChainId, def.id);

    if (def.onChainId >= Number(count)) {
      bad(`${def.id}: onChainId ${def.onChainId} but only ${count} grove(s) exist`);
      continue;
    }

    const g = await gm.read.groves([BigInt(def.onChainId)]);
    const comps = await gm.read.groveComposition([BigInt(def.onChainId), g[2]]);
    console.log(`  name "${g[0]}"  feeBps ${g[1]}  version ${g[2]}  users ${g[3]}  basis ${Number(g[4]) / 1e6} USDG`);

    if (g[0] !== def.name) bad(`${def.id}: on-chain name "${g[0]}" != registry "${def.name}"`);
    if (Number(g[1]) !== def.feeBps) bad(`${def.id}: on-chain feeBps ${g[1]} != registry ${def.feeBps}`);
    if (comps.length !== def.components.length) {
      bad(`${def.id}: ${comps.length} components on-chain != ${def.components.length} in registry`);
    }

    // Compare as sets: on-chain order is an implementation detail, the mapping
    // token -> weight is the actual strategy.
    const onChainByToken = new Map(comps.map((c) => [c.token.toLowerCase(), Number(c.weightBps)]));
    for (const c of def.components) {
      const w = onChainByToken.get(c.address.toLowerCase());
      if (w === undefined) {
        bad(`${def.id}: ${c.symbol} (${c.address}) in registry but not on-chain`);
        continue;
      }
      if (w !== c.weightBps) bad(`${def.id}: ${c.symbol} weight ${w} on-chain != ${c.weightBps} in registry`);
      onChainByToken.delete(c.address.toLowerCase());
    }
    for (const [tok, w] of onChainByToken) bad(`${def.id}: on-chain holds ${tok} @ ${w} bps, absent from the registry`);

    // Feeds — a component with no feed is UNPRICEABLE: it cannot be bought.
    for (const c of def.components) {
      const f = await gm.read.feedOf([c.address]);
      if (f[0] === ZERO) {
        const eta = Number(await gm.read.pendingFeedEta([c.address]));
        const state = eta === 0 ? "MISSING" : eta > now ? `pending ${((eta - now) / 3600).toFixed(1)}h` : "MATURE";
        warn(`${def.id}: ${c.symbol} has no feed (${state}) — UNPRICEABLE, cannot be bought`);
        continue;
      }
      if (!same(f[0], c.feed)) bad(`${def.id}: ${c.symbol} feed ${f[0]} != token registry ${c.feed}`);
      if (Number(f[1]) !== FEED_HEARTBEAT) {
        warn(`${def.id}: ${c.symbol} heartbeat ${f[1]}s != ${FEED_HEARTBEAT}s`);
      }
      // A live feed that is already stale means every trade takes the wide band.
      try {
        const [, answer, , updatedAt] = await publicClient.readContract({
          address: f[0],
          abi: AGG_ABI,
          functionName: "latestRoundData",
        });
        const age = now - Number(updatedAt);
        if (answer <= 0n) bad(`${def.id}: ${c.symbol} feed answers ${answer}`);
        else if (age > Number(f[1])) {
          warn(`${def.id}: ${c.symbol} feed is ${(age / 3600).toFixed(1)}h old (> ${Number(f[1]) / 3600}h) — STALE band`);
        }
      } catch {
        bad(`${def.id}: ${c.symbol} feed ${f[0]} did not answer`);
      }
    }
  }

  // Groves on-chain that no registry entry claims are unreachable from the app.
  for (let i = 0; i < Number(count); i++) {
    if (!claimed.has(i)) {
      const g = await gm.read.groves([BigInt(i)]);
      warn(`grove ${i} "${g[0]}" is on-chain but no registry grove claims it (unreachable from the app)`);
    }
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  console.log("");
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const p of problems) console.log(`DRIFT ${p}`);
  if (problems.length) {
    console.log(`\n${problems.length} drift(s). The chain and the registry disagree.`);
    process.exitCode = 1;
  } else {
    console.log(`\nNo drift: every registry grove matches the chain.${warnings.length ? ` ${warnings.length} warning(s).` : ""}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
