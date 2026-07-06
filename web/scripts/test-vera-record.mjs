// Live-fire test of the VeraRecord trust layer on Robinhood Chain:
//   1. sign a RiskInference with Vera's agent key (web/.env.local),
//   2. submit record(...) from the ops wallet,
//   3. read the events back via Blockscout — the same path the app's
//      Vera-record / Activity readers use.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createWalletClient, createPublicClient, http, defineChain, encodeFunctionData, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const VERA_RECORD = "0x7ff1a5ee19330c165146488a7ad8af6cb41da1df";
const EXPECTED_SIGNER = "0xe532105523d4eD559c3a53E3E82D616bE1a085c5";
const OPS = "0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7";

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

const here = path.dirname(fileURLToPath(import.meta.url));
const readKey = (file, name) => {
  const line = readFileSync(path.resolve(here, file), "utf8").split(/\r?\n/).find((l) => l.startsWith(name + "="));
  return line.slice(name.length + 1).trim().split(/\s+/)[0].replace(/^['"]|['"]$/g, "");
};
const vera = privateKeyToAccount(readKey("../.env.local", "AGENT_SIGNER_PRIVATE_KEY"));
if (vera.address.toLowerCase() !== EXPECTED_SIGNER.toLowerCase()) throw new Error("signer mismatch — aborting");
const ops = privateKeyToAccount(readKey("../../contracts/.env", "PRIVATE_KEY"));
if (ops.address.toLowerCase() !== OPS.toLowerCase()) throw new Error("ops wallet mismatch — aborting");
console.log("Vera signer:", vera.address, "| submitter:", ops.address);

const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account: ops, chain, transport: http() });

// A real inference over the basket the ops wallet actually bought earlier.
const allocation = { note: "trust-layer live test", basket: ["NVDA", "AAPL"] };
const now = Math.floor(Date.now() / 1000);
const planId = keccak256(toHex(JSON.stringify({ allocation, nonce: now })));
const rec = keccak256(toHex(JSON.stringify(allocation)));
const assessedRisk = 4200, maxRisk = 5700;
const expiry = BigInt(now + 900);

const signature = await vera.signTypedData({
  domain: { name: "VeraRecord", version: "1", chainId: 4663, verifyingContract: VERA_RECORD },
  types: {
    RiskInference: [
      { name: "planId", type: "bytes32" },
      { name: "assessedRisk", type: "uint16" },
      { name: "maxRisk", type: "uint16" },
      { name: "expiry", type: "uint256" },
    ],
  },
  primaryType: "RiskInference",
  message: { planId, assessedRisk, maxRisk, expiry },
});
console.log("inference signed by Vera");

const RECORD_ABI = [{
  type: "function", name: "record", stateMutability: "nonpayable",
  inputs: [
    { name: "planId", type: "bytes32" }, { name: "recHash", type: "bytes32" },
    { name: "assessedRisk", type: "uint16" }, { name: "maxRisk", type: "uint16" },
    { name: "expiry", type: "uint256" }, { name: "signature", type: "bytes" },
    { name: "user", type: "address" }, { name: "agentId", type: "uint256" },
    { name: "usdSpent", type: "uint256" }, { name: "legCount", type: "uint256" },
  ], outputs: [],
}];

const h = await wallet.sendTransaction({
  to: VERA_RECORD,
  data: encodeFunctionData({
    abi: RECORD_ABI,
    functionName: "record",
    args: [planId, rec, assessedRisk, maxRisk, expiry, signature, OPS, 1n, 1200000n, 2n],
  }),
});
const r = await pub.waitForTransactionReceipt({ hash: h });
console.log("record tx:", r.status, h, "| events emitted:", r.logs.length);
console.log("explorer: https://robinhoodchain.blockscout.com/tx/" + h);

// Read back through Blockscout logs — the app's exact scanner path.
await new Promise((res) => setTimeout(res, 6000));
const topic0 = "0x" + "";
const url = `https://robinhoodchain.blockscout.com/api?module=logs&action=getLogs&address=${VERA_RECORD}&fromBlock=2429508&toBlock=latest`;
const logs = await (await fetch(url)).json();
console.log("Blockscout indexed logs on VeraRecord:", Array.isArray(logs.result) ? logs.result.length : logs.message);
