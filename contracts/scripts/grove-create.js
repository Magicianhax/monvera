const hre = require("hardhat");
const { getAddress } = require("viem");
const { robinhood, GROVE_MANAGER } = require("./lib/constants");
const { groveFromRegistry, readGroveRegistry } = require("./lib/registry");

// Create one registry grove on-chain, composition derived from
// web/src/lib/groves.ts — never retyped.
//
// createGrove has no timelock (version 1 applies immediately) but the name and
// feeBps are permanent: there is no setName, and feeBps has no setter. So this
// reads the result back and shouts if anything differs from the registry.
//
//   GROVE_IDS=titan npx hardhat run scripts/grove-create.js --network robinhood
//
// Afterwards set `onChainId` on that grove in web/src/lib/groves.ts to the id
// printed here — that field, not array position, is what the web reads.

const ZERO_COMPONENTS = 0;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

async function main() {
  const id = (process.env.GROVE_IDS || "").trim();
  if (!id || id.includes(",")) throw new Error("set GROVE_IDS to exactly one grove id");
  const def = groveFromRegistry(id);

  const publicClient = await hre.viem.getPublicClient({ chain: robinhood });
  const [owner] = await hre.viem.getWalletClients({ chain: robinhood });
  const gm = await hre.viem.getContractAt("GroveManager", GROVE_MANAGER, {
    client: { public: publicClient, wallet: owner },
  });
  const mined = (h) => publicClient.waitForTransactionReceipt({ hash: h });

  console.log(`\nGroveManager ${GROVE_MANAGER}`);
  console.log(`Owner        ${owner.account.address}`);
  console.log(`Grove        "${def.name}" (${def.id})  feeBps=${def.feeBps}  ${def.components.length} components\n`);

  if (def.onChainId !== undefined) {
    throw new Error(`registry says ${def.id} is already grove ${def.onChainId} — refusing to create a duplicate`);
  }

  // The name is permanent, so a second grove with the same name would be
  // indistinguishable forever. Check before spending gas.
  const count = Number(await gm.read.groveCount());
  for (let i = 0; i < count; i++) {
    const g = await gm.read.groves([BigInt(i)]);
    if (g[0] === def.name) throw new Error(`grove ${i} is already named "${def.name}" — refusing to create a duplicate`);
  }
  console.log(`${count} grove(s) already on-chain; this will be grove ${count}.`);

  const components = def.components.map((c) => ({ token: getAddress(c.address), weightBps: c.weightBps }));
  const sum = components.reduce((a, c) => a + c.weightBps, 0);
  if (sum !== 10_000) throw new Error(`weights sum to ${sum}, not 10000`);
  if (components.length === ZERO_COMPONENTS) throw new Error("no components");

  await mined(await gm.write.createGrove([def.name, def.feeBps, components]));

  // ── read back and prove it matches the registry ──────────────────────────
  const groveId = count;
  const g = await gm.read.groves([BigInt(groveId)]);
  const onChain = await gm.read.groveComposition([BigInt(groveId), g[2]]);

  console.log(`\ngrove ${groveId}: "${g[0]}"  feeBps=${g[1]}  version=${g[2]}`);
  const problems = [];
  if (g[0] !== def.name) problems.push(`name "${g[0]}" != "${def.name}"`);
  if (Number(g[1]) !== def.feeBps) problems.push(`feeBps ${g[1]} != ${def.feeBps}`);
  if (onChain.length !== def.components.length) {
    problems.push(`${onChain.length} components on-chain != ${def.components.length} in registry`);
  }
  for (let i = 0; i < Math.min(onChain.length, def.components.length); i++) {
    const want = def.components[i];
    const got = onChain[i];
    const ok = same(got.token, want.address) && Number(got.weightBps) === want.weightBps;
    console.log(
      `  ${ok ? "ok  " : "BAD "} ${want.symbol.padEnd(6)} ${got.token}  ${Number(got.weightBps) / 100}%`,
    );
    if (!ok) problems.push(`component ${i}: ${got.token}@${got.weightBps} != ${want.address}@${want.weightBps}`);
  }

  if (problems.length) {
    console.error(`\nMISMATCH — on-chain does not match the registry:`);
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error("created grove does not match the registry");
  }

  console.log(`\nMatches the registry exactly.`);
  console.log(`\nNext: set  onChainId: ${groveId}  on "${def.id}" in web/src/lib/groves.ts`);
  const others = readGroveRegistry().filter((x) => x.id !== def.id && x.onChainId === undefined);
  if (others.length) console.log(`Still preview-only: ${others.map((x) => x.id).join(", ")}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
