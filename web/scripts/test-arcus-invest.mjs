// Live-fire test of the AI-invest engine primitives on Robinhood Chain.
//
// Phase A — SELL: swap the wallet's NVDA back to USDG (proves the sell path).
// Phase B — BASKET: two buy legs (NVDA + AAPL) settled in ONE transaction via
//   Multicall3.aggregate3. This proves the two assumptions the app's invest
//   flow rests on:
//     1. multiple Permit2 settles batch fine in a single tx (distinct nonces),
//     2. the settlement contract accepts a RELAYED sender (msg.sender is
//        Multicall3 here, not the taker) — the same shape as the app's
//        smart-account relay.
//
// Usage: node scripts/test-arcus-invest.mjs   (key from ../contracts/.env, never printed)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createWalletClient, createPublicClient, http, defineChain, encodeFunctionData, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const EXPECTED = "0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"; // lib/tokens.ts registry
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ROUTER = "https://router.spot.arcus.xyz";

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/.env");
const pkLine = readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("PRIVATE_KEY="));
const pk = pkLine.slice("PRIVATE_KEY=".length).trim().split(/\s+/)[0].replace(/^['"]|['"]$/g, "");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
if (account.address.toLowerCase() !== EXPECTED.toLowerCase()) throw new Error("wrong key — aborting");
console.log("wallet:", account.address);

const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const MC3 = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [{ name: "calls", type: "tuple[]", components: [
      { name: "target", type: "address" },
      { name: "allowFailure", type: "bool" },
      { name: "callData", type: "bytes" },
    ]}],
    outputs: [{ name: "returnData", type: "tuple[]", components: [
      { name: "success", type: "bool" },
      { name: "returnData", type: "bytes" },
    ]}],
  },
];

const bal = (token, who = account.address) => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [who] });

async function firmQuote(sellToken, buyToken, sellAmount) {
  const qs = new URLSearchParams({
    chainId: "4663", sellToken, buyToken, sellAmount: sellAmount.toString(),
    taker: account.address, slippageBps: "100", referralCode: "NANI",
  });
  const j = await (await fetch(`${ROUTER}/v1/quote?${qs}`)).json();
  const all = j.all ?? [];
  const q = (j.recommended && all.find((x) => x.venue === j.recommended && x.tx)) || all.find((x) => x.tx);
  if (!q?.tx || !q?.toSign) throw new Error(`no quote: ${JSON.stringify(j).slice(0, 200)}`);
  return q;
}

async function signedSettle(q) {
  const { EIP712Domain: _i, ...types } = q.toSign.types;
  const sig = await account.signTypedData({ domain: q.toSign.domain, types, primaryType: q.toSign.primaryType, message: q.toSign.message });
  const start = q.tx.signatureOffset * 2;
  const d = q.tx.data.slice(2);
  return { to: q.tx.to, data: `0x${d.slice(0, start)}${sig.slice(2)}${d.slice(start + sig.slice(2).length)}` };
}

// ── Phase A: sell all NVDA back to USDG ──────────────────────────────────────
const nvdaHeld = await bal(NVDA);
if (nvdaHeld > 0n) {
  // NVDA -> Permit2 allowance (sell pulls the stock token through Permit2)
  const alw = await pub.readContract({ address: NVDA, abi: ERC20, functionName: "allowance", args: [account.address, "0x000000000022D473030F116dDEE9F6B43aC78BA3"] });
  if (alw < nvdaHeld) {
    const h = await wallet.sendTransaction({ to: NVDA, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: ["0x000000000022D473030F116dDEE9F6B43aC78BA3", 2n ** 256n - 1n] }) });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log("A: NVDA->Permit2 approved");
  }
  const q = await firmQuote(NVDA, USDG, nvdaHeld);
  console.log(`A: SELL quote ${formatUnits(nvdaHeld, 18)} NVDA -> ${formatUnits(BigInt(q.buyAmount), 6)} USDG (${q.venue})`);
  const call = await signedSettle(q);
  const h = await wallet.sendTransaction({ to: call.to, data: call.data });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("A: sell settle:", r.status, h);
  if (r.status !== "success") throw new Error("sell reverted");
} else {
  console.log("A: no NVDA held — skipping sell");
}

const usdgNow = await bal(USDG);
console.log("cash after A:", formatUnits(usdgNow, 6), "USDG");

// ── Phase B: 2-leg basket in ONE tx via Multicall3 (relayed sender) ─────────
const legUsd = (usdgNow - 20_000n) / 2n; // keep a little dust, split evenly
if (legUsd < 500_000n) throw new Error("not enough USDG for two >= $0.50 legs");
console.log(`B: basket = ${formatUnits(legUsd, 6)} USDG -> NVDA + ${formatUnits(legUsd, 6)} USDG -> AAPL, one tx`);

const [qNvda, qAapl] = [await firmQuote(USDG, NVDA, legUsd), await firmQuote(USDG, AAPL, legUsd)];
console.log(`B: quotes  NVDA=${formatUnits(BigInt(qNvda.buyAmount), 18)} (${qNvda.venue})  AAPL=${formatUnits(BigInt(qAapl.buyAmount), 18)} (${qAapl.venue})`);
const [cNvda, cAapl] = [await signedSettle(qNvda), await signedSettle(qAapl)];

const aggData = encodeFunctionData({
  abi: MC3,
  functionName: "aggregate3",
  args: [[
    { target: cNvda.to, allowFailure: false, callData: cNvda.data },
    { target: cAapl.to, allowFailure: false, callData: cAapl.data },
  ]],
});
const aaplBefore = await bal(AAPL);
const nvdaBefore = await bal(NVDA);
const h = await wallet.sendTransaction({ to: MULTICALL3, data: aggData });
const r = await pub.waitForTransactionReceipt({ hash: h });
console.log("B: batched settle (sender = Multicall3):", r.status, h);
console.log("explorer: https://robinhoodchain.blockscout.com/tx/" + h);

const [nvdaAfter, aaplAfter, usdgAfter] = [await bal(NVDA), await bal(AAPL), await bal(USDG)];
console.log("result:", formatUnits(nvdaAfter - nvdaBefore, 18), "NVDA +", formatUnits(aaplAfter - aaplBefore, 18), "AAPL bought;", formatUnits(usdgAfter, 6), "USDG left");
if (r.status === "success") {
  console.log("PROVEN: multi-leg single-tx batching + relayed-sender settlement both work.");
}
