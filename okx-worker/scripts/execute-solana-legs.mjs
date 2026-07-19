// Executes Vera's /v1/build legs on Solana via the OKX DEX aggregator,
// signing with a LOCAL wallet — this is the buyer's side of the non-custodial
// story (Vera never sees this key). Sequential, one leg at a time, per the
// leg contract: quote/build -> sign -> send -> confirm -> next.
//
// Run: node scripts/execute-solana-legs.mjs <legs.json> <wallet.txt>
//   legs.json   — the /v1/build response
//   wallet.txt  — KEY=VALUE file with SOLANA_PRIVATE_KEY_BASE58
// Env: OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE (or D:\Tools\mantle\okx\.env)
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { Connection, Keypair, VersionedTransaction, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const [, , legsPath, walletPath] = process.argv;
if (!legsPath || !walletPath) {
  console.error("usage: node execute-solana-legs.mjs <legs.json> <wallet.txt>");
  process.exit(1);
}

if (!process.env.OKX_API_KEY) {
  try {
    for (const line of readFileSync("D:\\Tools\\mantle\\okx\\.env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) process.env[m[1]] ??= m[2];
    }
  } catch {}
}

const walletFile = readFileSync(walletPath, "utf8");
const keyB58 = walletFile.match(/^SOLANA_PRIVATE_KEY_BASE58=(.+)$/m)?.[1]?.trim();
if (!keyB58) throw new Error("SOLANA_PRIVATE_KEY_BASE58 not found in wallet file");
const keypair = Keypair.fromSecretKey(bs58.decode(keyB58));
console.log("buyer wallet:", keypair.publicKey.toBase58());

const { legs } = JSON.parse(readFileSync(legsPath, "utf8"));
console.log(`${legs.length} legs to execute\n`);

const BASE = "https://web3.okx.com";
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

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function executeLeg(leg, index) {
  // No referral fee (removed 2026-07-20) — the swap carries only its own slippage tolerance.
  const path =
    `/api/v6/dex/aggregator/swap?chainIndex=${leg.chainIndex}` +
    `&fromTokenAddress=${leg.tokenIn}&toTokenAddress=${leg.tokenOut}` +
    `&amount=${leg.amountIn}&slippagePercent=1&userWalletAddress=${keypair.publicKey.toBase58()}`;
  const res = await fetch(BASE + path, { headers: headers("GET", path) });
  const body = await res.json();
  if (body.code !== "0" || !body.data?.[0]) {
    throw new Error(`swap build failed for ${leg.symbol}: ${body.code} ${body.msg}`);
  }
  const txData = body.data[0].tx?.data;
  if (!txData) throw new Error(`no tx data for ${leg.symbol}`);

  // OKX returns Solana tx bytes base58-encoded (base64 as a fallback).
  let raw;
  try {
    raw = Buffer.from(bs58.decode(txData));
  } catch {
    raw = Buffer.from(txData, "base64");
  }
  let signature;
  try {
    const vtx = VersionedTransaction.deserialize(raw);
    vtx.sign([keypair]);
    signature = await connection.sendRawTransaction(vtx.serialize(), { maxRetries: 3 });
  } catch (err) {
    if (String(err).includes("deserialize") || String(err).includes("version")) {
      const ltx = Transaction.from(raw);
      ltx.partialSign(keypair);
      signature = await connection.sendRawTransaction(ltx.serialize(), { maxRetries: 3 });
    } else {
      throw err;
    }
  }
  console.log(`[${index + 1}/${legs.length}] ${leg.symbol} $${Number(leg.amountIn) / 1e6} -> sent ${signature}`);

  // Confirm before moving to the next leg (per-leg rule).
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const st = await connection.getSignatureStatuses([signature]);
    const s = st.value[0];
    if (s?.err) throw new Error(`${leg.symbol} tx failed on-chain: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
      console.log(`         confirmed (${s.confirmationStatus})`);
      return signature;
    }
  }
  throw new Error(`${leg.symbol} tx not confirmed after 60s: ${signature}`);
}

const results = [];
const failures = [];
for (let i = 0; i < legs.length; i++) {
  await sleep(1500); // trial API key is ~1 RPS
  try {
    results.push({ symbol: legs[i].symbol, signature: await executeLeg(legs[i], i) });
  } catch (err) {
    // A failed leg never blocks the rest — report it and move on.
    console.error(`[${i + 1}/${legs.length}] ${legs[i].symbol} FAILED: ${err.message}`);
    failures.push({ symbol: legs[i].symbol, error: err.message });
  }
}
console.log(`\nEXECUTED ${results.length}/${legs.length} LEGS:`);
for (const r of results) console.log(`  ${r.symbol}: https://solscan.io/tx/${r.signature}`);
if (failures.length) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  ${f.symbol}: ${f.error}`);
}
