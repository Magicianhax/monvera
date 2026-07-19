// Probes every universe name with a real $10 swap-build against the OKX
// aggregator and reports which ones cannot actually execute (code 82000 etc).
// Run: node scripts/sweep-tradability.mjs
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync("D:\\Tools\\mantle\\okx\\.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] ??= m[2];
}

const src = readFileSync(new URL("../src/universe.ts", import.meta.url), "utf8");
const mints = [...src.matchAll(/"symbol": "([A-Za-z.]+)",[\s\S]*?"mint": "([A-Za-z0-9]+)"/g)].map(
  (m) => ({ symbol: m[1], mint: m[2] })
);
console.log("sweeping", mints.length, "names...");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
for (const a of mints) {
  await sleep(1400); // trial key ~1 RPS
  const path =
    `/api/v6/dex/aggregator/swap?chainIndex=501` +
    `&fromTokenAddress=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` +
    `&toTokenAddress=${a.mint}&amount=10000000&slippagePercent=1` +
    `&userWalletAddress=HEsj32dSrwVefT5v1gLMteaVgKMhjB9nMh7hKi7SkLsy`;
  const ts = new Date().toISOString();
  const sign = crypto
    .createHmac("sha256", process.env.OKX_SECRET_KEY)
    .update(ts + "GET" + path)
    .digest("base64");
  const res = await fetch("https://web3.okx.com" + path, {
    headers: {
      "OK-ACCESS-KEY": process.env.OKX_API_KEY,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": process.env.OKX_PASSPHRASE,
    },
  })
    .then((r) => r.json())
    .catch(() => ({ code: "net" }));
  const ok = res.code === "0" && res.data?.[0]?.tx?.data;
  process.stdout.write((ok ? "+" : "-") + a.symbol + " ");
  if (!ok) bad.push(a.symbol);
}
console.log("\n\nUNTRADABLE (" + bad.length + "):", bad.join(" "));
writeFileSync("D:\\Tools\\mantle\\okx\\untradable.json", JSON.stringify(bad));
