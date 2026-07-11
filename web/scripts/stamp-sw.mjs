// Stamp a unique build id into the service worker's CACHE_VERSION.
//
// public/sw.js ships with the literal token `monvera-__BUILD_ID__`. This runs
// AFTER `opennextjs-cloudflare build` (which copies public/ to .open-next/assets)
// and BEFORE deploy, replacing the token in the built copy so every deploy gets a
// fresh cache version. That forces the SW to drop the previous precache on
// activation, so a returning user can never be stuck on a stale app shell whose
// hashed chunks were deleted from the origin. Source stays clean (only the build
// output is stamped).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const SW_PATH = ".open-next/assets/sw.js";
const TOKEN = "__BUILD_ID__";

if (!existsSync(SW_PATH)) {
  console.error(`[stamp-sw] ${SW_PATH} not found — run after the OpenNext build.`);
  process.exit(1);
}

let sha = "nogit";
try {
  sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  /* not a git checkout — the timestamp alone still makes it unique */
}
// sha changes per commit; the timestamp guarantees uniqueness even on a re-deploy
// of the same commit. Base-36 keeps it short.
const buildId = `${sha}-${Date.now().toString(36)}`;

const src = readFileSync(SW_PATH, "utf8");
if (!src.includes(TOKEN)) {
  console.error(`[stamp-sw] token ${TOKEN} not present in ${SW_PATH} — nothing stamped.`);
  process.exit(1);
}
writeFileSync(SW_PATH, src.split(TOKEN).join(buildId), "utf8");
console.log(`[stamp-sw] CACHE_VERSION -> monvera-${buildId}`);
