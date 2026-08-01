const { writeFileSync, mkdtempSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

// Read the Grove registry (web/src/lib/groves.ts) from a Hardhat script.
//
// Deploy scripts must NEVER retype a composition by hand. On 2026-07-27 the
// day-0 script did exactly that — it invented a "Blue Chips" basket that
// matched no registry entry, so on-chain grove 0 corresponded to nothing the
// web could name. Everything that touches the chain now derives its truth from
// the same file the product renders, so the two cannot disagree.
//
// The registry is TypeScript with its own build-time weight/symbol validation.
// esbuild (already a web dependency) bundles it to CJS so plain node can load
// it — and that validation runs on the way through, so a bad registry throws
// here rather than reaching the chain. Its Node API is used rather than the
// bin: spawning a .cmd shim fails EINVAL on Windows/Node 22.

const WEB = resolve(__dirname, "../../../web");

/**
 * Every grove in the registry, with each component's token and Chainlink feed
 * address resolved from the same token registry the app uses.
 * @returns {{id:string,name:string,feeBps:number,onChainId:number|undefined,
 *            components:{symbol:string,address:string,feed:string,weightBps:number}[]}[]}
 */
function readGroveRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "grove-registry-"));
  const entry = join(dir, "entry.mjs");
  const out = join(dir, "bundle.cjs");

  writeFileSync(
    entry,
    `import { GROVES } from ${JSON.stringify(join(WEB, "src/lib/groves.ts"))};
     import { assetBySymbol } from ${JSON.stringify(join(WEB, "src/lib/tokens.ts"))};
     export const groves = GROVES.map((g) => ({
       id: g.id,
       name: g.name,
       feeBps: g.feeBps,
       onChainId: g.onChainId,
       components: g.components.map((c) => {
         const a = assetBySymbol(c.symbol);
         if (!a) throw new Error("no token for " + c.symbol);
         return { symbol: c.symbol, address: a.address, feed: a.feed, weightBps: c.weightBps };
       }),
     }));`,
  );

  const esbuild = require(require.resolve("esbuild", { paths: [WEB] }));
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "warning",
    outfile: out,
  });

  return require(out).groves;
}

/** One grove by registry id, or throws naming what is available. */
function groveFromRegistry(id) {
  const all = readGroveRegistry();
  const hit = all.find((g) => g.id === id);
  if (!hit) throw new Error(`no grove "${id}" in the registry (have: ${all.map((g) => g.id).join(", ")})`);
  return hit;
}

module.exports = { readGroveRegistry, groveFromRegistry };
