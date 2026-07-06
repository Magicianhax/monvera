// Live-fire test of the Arcus spot RFQ path on Robinhood Chain.
//
// Proves the ONE link the app hasn't verified on-chain yet: firm quote ->
// EOA signs the Permit2 PermitWitnessTransferFrom -> signature spliced into
// tx.data at signatureOffset -> settlement lands. Uses the funded ops wallet
// directly (its own ETH pays gas) so the test isolates Arcus settlement from
// the (already-proven) Pimlico relay.
//
// Usage:  node scripts/test-arcus-buy.mjs            ($1 USDG -> NVDA)
// Key:    read from ../contracts/.env (PRIVATE_KEY). Never printed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createWalletClient, createPublicClient, http, defineChain, encodeFunctionData, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const EXPECTED = "0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ROUTER = "https://router.spot.arcus.xyz";
const SPEND = 1_000_000n; // $1.00 USDG (6dp)

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

// Load the key from contracts/.env without ever echoing it.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/.env");
const pkLine = readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("PRIVATE_KEY="));
if (!pkLine) throw new Error("PRIVATE_KEY not found in contracts/.env");
// Value may carry a trailing inline comment — the key is the first token.
const pk = pkLine.slice("PRIVATE_KEY=".length).trim().split(/\s+/)[0].replace(/^['"]|['"]$/g, "");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
if (account.address.toLowerCase() !== EXPECTED.toLowerCase()) {
  throw new Error(`Derived address ${account.address} does not match expected wallet — aborting.`);
}
console.log("wallet:", account.address, "(matches expected)");

const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const nvdaBefore = await pub.readContract({ address: NVDA, abi: ERC20, functionName: "balanceOf", args: [account.address] });
const usdgBefore = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [account.address] });
console.log("before:", formatUnits(usdgBefore, 6), "USDG |", formatUnits(nvdaBefore, 18), "NVDA");
if (usdgBefore < SPEND) throw new Error("Not enough USDG for the $1 test.");

// 1) one-time USDG -> Permit2 approval (direct tx; the wallet has ETH)
const allowance = await pub.readContract({ address: USDG, abi: ERC20, functionName: "allowance", args: [account.address, PERMIT2] });
if (allowance < SPEND) {
  console.log("approving USDG -> Permit2 ...");
  const h = await wallet.sendTransaction({
    to: USDG,
    data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, 2n ** 256n - 1n] }),
  });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("approve:", r.status, h);
  if (r.status !== "success") throw new Error("approve reverted");
} else {
  console.log("Permit2 allowance already in place");
}

// 2) firm quote: $1 USDG -> NVDA
const qs = new URLSearchParams({
  chainId: "4663",
  sellToken: USDG,
  buyToken: NVDA,
  sellAmount: SPEND.toString(),
  taker: account.address,
  slippageBps: "100",
  referralCode: "NANI",
});
const qres = await fetch(`${ROUTER}/v1/quote?${qs}`);
const qjson = await qres.json();
const all = qjson.all ?? [];
const q = (qjson.recommended && all.find((x) => x.venue === qjson.recommended && x.tx)) || all.find((x) => x.tx);
if (!q?.tx || !q?.toSign) throw new Error(`no executable quote: ${JSON.stringify(qjson).slice(0, 300)}`);
console.log(`quote: venue=${q.venue} buyAmount=${formatUnits(BigInt(q.buyAmount), 18)} NVDA, sigOffset=${q.tx.signatureOffset}`);

// 3) sign the Permit2 intent (plain EOA 65-byte signature)
const { EIP712Domain: _ignored, ...types } = q.toSign.types;
const signature = await account.signTypedData({
  domain: q.toSign.domain,
  types,
  primaryType: q.toSign.primaryType,
  message: q.toSign.message,
});
console.log("intent signed (65 bytes:", (signature.length - 2) / 2 === 65, ")");

// 4) splice signature into the settlement calldata
const start = q.tx.signatureOffset * 2;
const d = q.tx.data.slice(2);
const s = signature.slice(2);
const settleData = `0x${d.slice(0, start)}${s}${d.slice(start + s.length)}`;

// 5) send the settlement
console.log("settling via", q.tx.to, "...");
const settleHash = await wallet.sendTransaction({
  to: q.tx.to,
  data: settleData,
  value: BigInt(q.tx.value ?? "0"),
});
const settle = await pub.waitForTransactionReceipt({ hash: settleHash });
console.log("settle:", settle.status, settleHash);
console.log("explorer: https://robinhoodchain.blockscout.com/tx/" + settleHash);

const nvdaAfter = await pub.readContract({ address: NVDA, abi: ERC20, functionName: "balanceOf", args: [account.address] });
const usdgAfter = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [account.address] });
console.log("after:", formatUnits(usdgAfter, 6), "USDG |", formatUnits(nvdaAfter, 18), "NVDA");
console.log("delta:", formatUnits(nvdaAfter - nvdaBefore, 18), "NVDA for", formatUnits(usdgBefore - usdgAfter, 6), "USDG");
