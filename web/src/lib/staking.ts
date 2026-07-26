// $MONVERA staking — chain config, addresses, ABIs.
//
// MAINNET (Robinhood Chain 4663). Deployed 2026-07-24; MonveraStaking is
// ownerless with an immutable 14-day cooldown, the registry + distributor are
// owned by the cold key. The reward token is the real $MONVERA (no open mint).
// The testnet deployment lives on in git history.
//
// TWO CLIENTS, ON PURPOSE. Measured 2026-07-25:
//   - Contract reads: the public endpoint returns 403 under any real request
//     rate, so balances go dark exactly when traffic arrives. Alchemy answers
//     eth_call in ~460ms. Reads therefore go to NEXT_PUBLIC_RPC_URL.
//   - Log scans: Alchemy's FREE tier caps eth_getLogs at a TEN block range
//     ("Under the Free tier plan..."), which is far worse than the public
//     endpoint's ~2000. Sending the season scan there would turn one request
//     into ~90,000. So getLogs deliberately stays on the public RPC, which is
//     fine because that scan runs server-side, chunked, once per 30s, cached
//     in KV and shared fleet-wide.
// Point STAKING_LOGS_RPC_URL at a paid endpoint to move the scan too.
import { defineChain, http, createPublicClient, parseAbi } from "viem";

export const STAKING_TESTNET = false;

/** Never keyed: it serves the log scan, and Alchemy's free tier cannot. */
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const READ_RPC = process.env.NEXT_PUBLIC_RPC_URL || PUBLIC_RPC;
/** Server-only, so a key here is never inlined into the browser bundle. */
const LOGS_RPC = process.env.STAKING_LOGS_RPC_URL || PUBLIC_RPC;

export const stakingChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [READ_RPC] } },
});

export const STAKING_ADDRESSES = {
  token: "0x7541872e32bb529d7ff11d6c59832269ce33a6ff" as `0x${string}`, // $MONVERA (18dp)
  staking: "0xd6b6c5587499fea30d5c5147ebec1f6043c27f2a" as `0x${string}`,
  curatorRegistry: "0xe1882878df4e39566abea9ef9200d73dba83a0cf" as `0x${string}`,
  seasonDistributor: "0xe51658ee2fed7ae09b81a91e2e0ffc6698648163" as `0x${string}`,
} as const;

/** Season 1 pool: 2,000,000 $MONVERA (0.20% of supply), paid as flat daily buckets. */
export const SEASON_POOL = 2_000_000;
export const SEASON_DAYS = 90;
/** 2,000,000 / 90, display-rounded. Never used for reward math (that is off-chain, in wei). */
export const DAILY_BUCKET = 22_222;

// ── Epoch vocabulary ────────────────────────────────────────────────────────
// One EPOCH == one UTC day, and it is the unit users actually reason about: an
// epoch's reward is split by stake-time, banks when the epoch closes at 00:00
// UTC, and never moves again. Aliases (not a rename) so every user-facing
// surface can say "epoch" while the reward maths keeps its day-based names.
export const EPOCH_SECONDS = 86_400;
/** Total epochs in a season (one per day). */
export const SEASON_EPOCHS = SEASON_DAYS;
/** $MONVERA paid out per epoch, display-rounded. */
export const EPOCH_REWARD = DAILY_BUCKET;
/** Curator eligibility gate (mirrors GroveCuratorRegistry's minCuratorStake). */
export const CURATOR_GATE = 500_000;
/** UTC unix seconds of Season 1 day-0. 0 = not started yet — the season strip
 *  then shows a full pool and no progress. Owner sets NEXT_PUBLIC_SEASON_START at launch. */
export const SEASON_START_UTC = Number(process.env.NEXT_PUBLIC_SEASON_START ?? 0);

export const stakingTokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)", // tMONVERA only — open mint on testnet
]);

export const stakingAbi = parseAbi([
  "function stake(uint256)",
  "function requestUnstake(uint256)",
  "function cancelUnstake()",
  "function withdraw()",
  "function stakedOf(address) view returns (uint256)",
  "function pendingOf(address) view returns (uint256, uint64)",
  "function weightOf(address) view returns (uint256)",
  "function totalWeight() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function cooldown() view returns (uint256)",
  "event Staked(address indexed user, uint256 amount, uint256 stakedAfter)",
  "event UnstakeRequested(address indexed user, uint256 amount, uint256 pendingAfter, uint64 unlockAt)",
  "event UnstakeCancelled(address indexed user, uint256 amount, uint256 stakedAfter)",
  "event Withdrawn(address indexed user, uint256 amount)",
]);

export const seasonDistributorAbi = parseAbi([
  "function seasonCount() view returns (uint256)",
  "function seasons(uint256) view returns (bytes32 root, uint256 pool, uint256 claimed, uint64 claimDeadline)",
  "function hasClaimed(uint256, address) view returns (bool)",
  "function claim(uint256 seasonId, address account, uint256 amount, bytes32[] proof)",
]);

/** Log-scan client. Server-side only (the browser never scans logs). Kept on an
 *  endpoint that allows wide eth_getLogs ranges — see the note at the top. */
export const stakingLogsClient = createPublicClient({
  chain: stakingChain,
  transport: http(LOGS_RPC, { timeout: 20_000, retryCount: 2 }),
});

/** Read client for the staking chain — separate from the app's 4663 client. */
export const stakingClient = createPublicClient({
  chain: stakingChain,
  transport: http(stakingChain.rpcUrls.default.http[0], { timeout: 8_000, retryCount: 1 }),
});
