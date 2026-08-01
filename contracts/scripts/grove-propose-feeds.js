const hre = require("hardhat");
const { robinhood, GROVE_MANAGER, FEED_HEARTBEAT } = require("./lib/constants");
const { readGroveRegistry } = require("./lib/registry");

// Propose (or re-propose) the Chainlink feed for every token in the selected
// groves, at the heartbeat in lib/constants. Idempotent: a feed already live on
// the right aggregator AND heartbeat is skipped, so this is safe to re-run.
//
// A feed is what lets the contract price a token at all — no feed means
// UNPRICEABLE: no entry, exit always allowed. Registering one takes 48h.
//
// Re-proposing an already-pending feed simply overwrites it and restarts the
// 48h clock (proposeFeed assigns, it does not reject a duplicate).
//
// Select groves with GROVE_IDS (comma-separated); default is every grove that
// already has an onChainId. GROVE_DRY=1 reports without sending anything.
//
//   GROVE_IDS=titan npx hardhat run scripts/grove-propose-feeds.js --network robinhood

const AGG_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
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

const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const DRY = process.env.GROVE_DRY === "1";

async function main() {
  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [owner] = await hre.viem.getWalletClients({ chain: robinhood });
  const gm = await hre.viem.getContractAt("GroveManager", GROVE_MANAGER, {
    client: { public: publicClient, wallet: owner },
  });
  const mined = (h) => publicClient.waitForTransactionReceipt({ hash: h });

  const wanted = (process.env.GROVE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const registry = readGroveRegistry();
  const groves = wanted.length
    ? registry.filter((g) => wanted.includes(g.id))
    : registry.filter((g) => g.onChainId !== undefined);
  if (!groves.length) throw new Error(`no groves selected (GROVE_IDS=${process.env.GROVE_IDS || "<unset>"})`);

  // One entry per token — groves overlap heavily and a feed is per-token.
  const tokens = new Map();
  for (const g of groves) {
    for (const c of g.components) {
      if (!c.feed) throw new Error(`${c.symbol} has no feed in the token registry`);
      if (!tokens.has(c.address.toLowerCase())) tokens.set(c.address.toLowerCase(), c);
    }
  }

  console.log(`\nGroveManager ${GROVE_MANAGER}`);
  console.log(`Owner        ${owner.account.address}`);
  console.log(`Groves       ${groves.map((g) => g.id).join(", ")}`);
  console.log(`Heartbeat    ${FEED_HEARTBEAT}s (${FEED_HEARTBEAT / 3600}h)${DRY ? "   [DRY RUN]" : ""}\n`);

  const now = Math.floor(Date.now() / 1000);
  let proposed = 0;

  for (const c of [...tokens.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    // Never propose a feed without looking at it first: a dead aggregator would
    // be rejected on-chain, but a live one answering a stale or absurd price is
    // ours to catch.
    let age = null;
    try {
      const [, answer, , updatedAt] = await publicClient.readContract({
        address: c.feed,
        abi: AGG_ABI,
        functionName: "latestRoundData",
      });
      age = now - Number(updatedAt);
      if (answer <= 0n) {
        console.log(`  SKIP     ${c.symbol.padEnd(6)} feed answers ${answer} — refusing to propose`);
        continue;
      }
    } catch {
      console.log(`  SKIP     ${c.symbol.padEnd(6)} feed ${c.feed} did not answer — refusing to propose`);
      continue;
    }
    const ageStr = `age ${(age / 3600).toFixed(1)}h`;
    const fresh = age <= FEED_HEARTBEAT ? "fresh" : "STALE at this heartbeat";

    const live = await gm.read.feedOf([c.address]);
    if (live[0] !== ZERO && same(live[0], c.feed) && Number(live[1]) === FEED_HEARTBEAT) {
      console.log(`  LIVE     ${c.symbol.padEnd(6)} ${ageStr}, ${fresh}`);
      continue;
    }
    if (live[0] !== ZERO) {
      console.log(
        `  RETUNE   ${c.symbol.padEnd(6)} live heartbeat ${live[1]}s -> ${FEED_HEARTBEAT}s (48h until it applies)`,
      );
    }

    // The PENDING heartbeat is not readable on-chain (only its eta is), so a
    // pending entry cannot be compared — it can only be replaced. Re-proposing
    // restarts the 48h clock, which is why DRY exists: check state without
    // pushing the timelock out.
    const eta = Number(await gm.read.pendingFeedEta([c.address]));
    if (eta > now) {
      console.log(
        `           ${" ".repeat(6)} (replacing a pending proposal, ${((eta - now) / 3600).toFixed(1)}h in — clock restarts)`,
      );
    }
    if (DRY) {
      console.log(`  WOULD    ${c.symbol.padEnd(6)} propose ${c.feed} @ ${FEED_HEARTBEAT}s  ${ageStr}, ${fresh}`);
      continue;
    }

    await mined(await gm.write.proposeFeed([c.address, c.feed, FEED_HEARTBEAT]));
    proposed++;
    const newEta = Number(await gm.read.pendingFeedEta([c.address]));
    console.log(
      `  PROPOSED ${c.symbol.padEnd(6)} ${c.feed}  ${ageStr}, ${fresh}  applies ${new Date(newEta * 1000).toISOString()}`,
    );
  }

  console.log(
    DRY
      ? `\nDRY RUN — nothing sent.`
      : `\n${proposed} proposed. Run scripts/grove-apply.js once the timelock matures.`,
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
