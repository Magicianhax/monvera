const { defineChain } = require("viem");

// Shared chain-ops constants for every Grove script. One definition each, so a
// venue address or a heartbeat can never mean two different things depending on
// which script you happened to run.

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // 6dp
const TREASURY = "0xb87f5A74267ca3F9512b8511B32cCd804EA3707E"; // buyback treasury, IMMUTABLE at deploy
// Deployed 2026-07-27 with the bootstrap window, so venues and feeds were live
// on day 0. The earlier 0x8b707a85… is ORPHANED: it holds two unused groves and
// its venue whitelist never applied. Nothing points at it.
const GROVE_MANAGER = process.env.GROVE_MANAGER_ADDRESS || "0xf0b1a694b85f6868b335f1799a044c15da01e5a6";

// Feed staleness threshold, seconds. Above it a feed is STALE: the wide
// staleBandBps applies and the manager is locked out of that token.
//
// Measured 2026-07-27 over the last 150 rounds of all 8 basket feeds:
//
//   intra-week gaps   p50 0.3-1.9h   p90 2.7-9.7h   p95 4.3-11.6h   max 18.8h
//   weekend gaps      52.1h - 73.1h
//
// These are deviation-driven feeds with a long heartbeat, so a quiet name can
// legitimately sit for most of a session. 24h clears every observed intra-week
// gap while staying far below the shortest weekend gap — which is exactly the
// line staleBandBps is meant to draw ("market closed"). Comfortably inside
// MAX_FEED_AGE (5 days), so a weekend never makes a grove UNPRICEABLE.
//
// The original 7200s came from a single afternoon's sample and was wrong: it
// would have marked most of the basket STALE most of the time, pinning every
// trade to the wide band and disabling auto-manage permanently.
const FEED_HEARTBEAT = 86_400;

// Venues the GroveManager may touch. `asApproval` selects the role:
// false = a contract we may CALL, true = a spender we may APPROVE. Venues
// needing both roles appear twice — Kyber's router is its own spender.
//
// LiFi is deliberately absent: its approvalAddress can vary per quote, so it
// must be pinned from a live 4663 quote before being proposed.
const VENUES = [
  { addr: "0x8876789976dEcBfCbBbe364623C63652db8C0904", asApproval: false, label: "UniversalRouter (call)" },
  { addr: "0x000000000022D473030F116dDEE9F6B43aC78BA3", asApproval: true, label: "Permit2 (approve)" },
  { addr: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", asApproval: false, label: "Kyber MetaAggregationRouterV2 (call)" },
  { addr: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", asApproval: true, label: "Kyber MetaAggregationRouterV2 (approve)" },
];

module.exports = { robinhood, USDG, TREASURY, GROVE_MANAGER, FEED_HEARTBEAT, VENUES };
