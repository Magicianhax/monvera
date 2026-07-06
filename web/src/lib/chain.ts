import { defineChain } from "viem";

// Robinhood Chain — the single source of truth for the network the app targets.
//
// Robinhood Chain is a permissionless, Arbitrum-stack L2 for tokenized stocks;
// native gas is ETH. Two networks exist and the target is env-selected via
// NEXT_PUBLIC_CHAIN_ID (default: testnet during the fork). RPC and explorer
// default to the public endpoints and can be overridden with NEXT_PUBLIC_RPC_URL /
// NEXT_PUBLIC_EXPLORER_URL (use an Alchemy Robinhood key in production to avoid
// public-RPC rate limits).

const NETWORKS = {
  mainnet: {
    id: 4663,
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  testnet: {
    id: 46630,
    name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
} as const;

// Mainnet by default (0x RFQ liquidity for the stock tokens is mainnet-only).
// Set NEXT_PUBLIC_CHAIN_ID=46630 to point at testnet.
const cfg =
  Number(process.env.NEXT_PUBLIC_CHAIN_ID) === NETWORKS.testnet.id
    ? NETWORKS.testnet
    : NETWORKS.mainnet;

export const CHAIN_ID: number = cfg.id;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || cfg.rpc;
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || cfg.explorer;

// Canonical Multicall3 — verified deployed at this deterministic address on both
// Robinhood networks (server viem clients use it to batch read bursts).
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** Robinhood Chain as a full viem Chain (formatters/fees/multicall wired). */
export const chain = defineChain({
  id: CHAIN_ID,
  name: cfg.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URL } },
  contracts: { multicall3: { address: MULTICALL3 } },
});
