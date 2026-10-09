// Browser-side staking event scan for the leaderboard and reward tiles.
//
// Why the browser: the public 4663 RPC answers every eth_getLogs/eth_call from
// Cloudflare's egress with HTTP 429 (probed from the edge, 2026-10-09) and
// Blockscout's API sits behind a Cloudflare challenge, so the Worker cannot
// read the history at all. Visitors' own IPs are served, CORS is open, and the
// RPC allows 10M blocks per address-only getLogs — a cold scan is ~7 calls.
//
// Incremental within the tab: the first load scans from the deploy block, each
// refetch only the blocks since. Every result must reconcile with the
// contract's totalStaked at the same block or it is refused (one full rescan
// first, in case the increment drifted) — a short scan never renders as data.
import { fetchStakeEvents } from "./fetch";
import { reconciles } from "./board";
import type { StakeEvent } from "./compute";
import { DEPLOY_BLOCK, STAKING } from "./config";
import { stakingAbi, stakingLogsClient as client } from "@/lib/staking";

const LOG_SPAN = BigInt(10_000_000); // the RPC's cap for an address-only filter

let cache: { events: StakeEvent[]; toBlock: bigint } | null = null;
let inflight: Promise<{ events: StakeEvent[]; headTs: bigint }> | null = null;

const scan = (from: bigint, to: bigint) =>
  from > to ? Promise.resolve([] as StakeEvent[]) : fetchStakeEvents(client, STAKING, from, to, LOG_SPAN, { explorer: false });

async function load(): Promise<{ events: StakeEvent[]; headTs: bigint }> {
  const head = await client.getBlockNumber();
  // Same tick, so the batching transport sends both in one request.
  const [blk, totalStaked] = await Promise.all([
    client.getBlock({ blockNumber: head }),
    client.readContract({ address: STAKING, abi: stakingAbi, functionName: "totalStaked", blockNumber: head }),
  ]);

  const base = cache && cache.toBlock <= head ? cache : null;
  let events = base ? [...base.events, ...(await scan(base.toBlock + BigInt(1), head))] : await scan(DEPLOY_BLOCK, head);
  if (base && !reconciles(events, totalStaked)) events = await scan(DEPLOY_BLOCK, head);
  if (!reconciles(events, totalStaked)) {
    cache = null;
    throw new Error(`staking events do not reconcile with totalStaked=${totalStaked}`);
  }
  cache = { events, toBlock: head };
  return { events, headTs: blk.timestamp };
}

/** The full staking event stream through the current head, reconciled. One
 *  scan at a time per tab, however many queries ask. */
export function loadLiveEvents(): Promise<{ events: StakeEvent[]; headTs: bigint }> {
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return inflight;
}
