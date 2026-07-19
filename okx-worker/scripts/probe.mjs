// Day-1 probes for the vera-okx worker (OKX ASP hackathon).
// Run: node scripts/probe.mjs
// Credentials: env vars or D:\Tools\mantle\okx\.env (OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE)
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

if (!process.env.OKX_API_KEY) {
  try {
    const env = readFileSync("D:\\Tools\\mantle\\okx\\.env", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) process.env[m[1]] ??= m[2];
    }
  } catch {}
}

const BASE = "https://web3.okx.com";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function headers(method, path) {
  const ts = new Date().toISOString();
  const sign = crypto
    .createHmac("sha256", process.env.OKX_SECRET_KEY)
    .update(ts + method + path)
    .digest("base64");
  return {
    "OK-ACCESS-KEY": process.env.OKX_API_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": process.env.OKX_PASSPHRASE,
    "Content-Type": "application/json",
  };
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: headers("GET", path) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // trial key = 1 RPS

// Probe 1: does the OKX aggregator quote USDC -> AAPLx on Solana (chainIndex 501)?
const quotePath =
  `/api/v6/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${USDC_SOL}` +
  `&toTokenAddress=${AAPLX}&amount=${50_000_000}`; // 50 USDC (6dp)
const p1 = await get(quotePath);
console.log("PROBE 1 — OKX quote USDC->AAPLx:", JSON.stringify(p1.body, null, 2)?.slice(0, 2500));

await sleep(1500);

// Probe 2: X Layer (196) token list — any xStock / X-prefixed equity contracts?
const tokensPath = `/api/v6/dex/aggregator/all-tokens?chainIndex=196`;
const p2 = await get(tokensPath);
const xlayerTokens = p2.body?.data ?? [];
const equityHits = xlayerTokens.filter((t) =>
  /^X[A-Z]{1,5}$/.test(t.tokenSymbol ?? "") || /xstock/i.test(t.tokenName ?? "")
);
console.log("PROBE 2 — X Layer token count:", xlayerTokens.length, "equity-like hits:", JSON.stringify(equityHits));

await sleep(1500);

// Probe 3: Solana token list — how many xStocks does OKX index?
const p3 = await get(`/api/v6/dex/aggregator/all-tokens?chainIndex=501`);
const solTokens = p3.body?.data ?? [];
const xs = solTokens.filter((t) => /xstock/i.test(t.tokenName ?? ""));
console.log(
  "PROBE 3 — OKX-indexed xStocks on Solana:",
  xs.length,
  xs.map((t) => `${t.tokenSymbol}:${t.tokenAddress}`).join(" ")
);
