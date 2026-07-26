// Fetch + decode the MonveraStaking event stream into StakeEvent[].
//
// TWO PATHS, measured 2026-07-25.
//
// FAST PATH: Blockscout. `/api/v2/addresses/{addr}/logs` returns the contract's
// whole history in ONE request with no block-range cap, and carries
// block_timestamp inline so the per-block eth_getBlockByNumber round-trips
// disappear too. The alternative is brutal: the public RPC caps eth_getLogs at
// 2000 blocks and the contract is already ~880,000 blocks back, so a cold scan
// is ~441 sequential requests and grows every day.
//
// Its indexer lags the chain head, which is why this file used to refuse it
// outright. That note said ~20k blocks; re-measured it is 408 (~14 min). Either
// way a lagging snapshot would silently drop the newest stakes, so the tail
// AFTER Blockscout's latest indexed block is always topped up from the RPC —
// a small recent window, which an endpoint will serve even when it refuses a
// wide one.
//
// SLOW PATH: pure chunked eth_getLogs, kept intact as the fallback for when
// Blockscout is unreachable. Correctness never depends on the explorer.
import type { PublicClient } from "viem";
import { decodeEventLog, parseAbiItem } from "viem";
import type { StakeEvent } from "./compute";

/** Explorer base for the fast path. Empty disables it and forces the RPC scan. */
const BLOCKSCOUT =
  process.env.STAKING_BLOCKSCOUT_URL ?? "https://robinhoodchain.blockscout.com";
/** Optional. The v2 API answers anonymously; a key only lifts the per-IP rate
 *  limit. Server-only name (no NEXT_PUBLIC_) so it stays out of the bundle. */
const BLOCKSCOUT_KEY = process.env.BLOCKSCOUT_API_KEY ?? "";

const EVENTS = [
  parseAbiItem("event Staked(address indexed user, uint256 amount, uint256 stakedAfter)"),
  parseAbiItem("event UnstakeRequested(address indexed user, uint256 amount, uint256 pendingAfter, uint64 unlockAt)"),
  parseAbiItem("event UnstakeCancelled(address indexed user, uint256 amount, uint256 stakedAfter)"),
  parseAbiItem("event Withdrawn(address indexed user, uint256 amount)"),
] as const;

const kindOf: Record<string, StakeEvent["kind"]> = {
  Staked: "Staked",
  UnstakeRequested: "UnstakeRequested",
  UnstakeCancelled: "UnstakeCancelled",
  Withdrawn: "Withdrawn",
};

type Raw = {
  blockNumber: bigint; logIndex: number; eventName: string;
  args: { user?: `0x${string}`; amount?: bigint; stakedAfter?: bigint };
  ts?: bigint;
};

/** One page of Blockscout logs. Returns null on any failure so the caller can
 *  fall back to the RPC scan rather than serving a short stream. */
async function blockscoutLogs(address: string): Promise<{ rows: Raw[]; maxBlock: bigint } | null> {
  if (!BLOCKSCOUT) return null;
  try {
    const rows: Raw[] = [];
    let maxBlock = BigInt(0);
    // Build every URL through one helper so the key survives pagination —
    // next_page_params carries only the cursor, not the auth.
    const pageUrl = (params?: Record<string, string | number>) => {
      const qs = new URLSearchParams(params as Record<string, string> | undefined);
      if (BLOCKSCOUT_KEY) qs.set("apikey", BLOCKSCOUT_KEY);
      const q = qs.toString();
      return `${BLOCKSCOUT}/api/v2/addresses/${address}/logs${q ? `?${q}` : ""}`;
    };
    let url: string | null = pageUrl();
    for (let page = 0; url && page < 20; page++) {
      const res: Response = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) return null;
      const j = (await res.json()) as {
        items?: { block_number: number; index: number; topics: (string | null)[]; data: string; block_timestamp?: string }[];
        next_page_params?: Record<string, string | number> | null;
      };
      for (const it of j.items ?? []) {
        // Decode from topics+data with our own ABI rather than trusting the
        // explorer's `decoded` block: same bytes the RPC path would see.
        const topics = it.topics.filter((t): t is string => !!t) as [signature: `0x${string}`, ...args: `0x${string}`[]];
        let dec;
        try {
          dec = decodeEventLog({ abi: EVENTS, topics, data: it.data as `0x${string}` });
        } catch {
          continue; // not one of ours
        }
        const bn = BigInt(it.block_number);
        if (bn > maxBlock) maxBlock = bn;
        rows.push({
          blockNumber: bn,
          logIndex: it.index,
          eventName: dec.eventName as string,
          args: dec.args as Raw["args"],
          ts: it.block_timestamp ? BigInt(Math.floor(Date.parse(it.block_timestamp) / 1000)) : undefined,
        });
      }
      const n = j.next_page_params;
      url = n ? pageUrl(n) : null;
    }
    return { rows, maxBlock };
  } catch {
    return null;
  }
}

/** Fetch all staking events in [fromBlock, toBlock], decoded and sorted by
 *  (blockNumber, logIndex), with timestamps resolved. Chunk halves on a
 *  range-too-large RPC error so it adapts to the endpoint's cap. */
export async function fetchStakeEvents(
  client: PublicClient,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  /** Starting block-range per getLogs. Shrinks on error / near-cap returns but
   *  never grows, so pass a large value for a permissive RPC (fewer round-trips)
   *  and the default for an unknown one. */
  initialStep: bigint = BigInt(5_000),
): Promise<StakeEvent[]> {
  const raw: Raw[] = [];

  // Fast path: whole history from the explorer in one call, then scan only the
  // blocks it has not indexed yet. `start` moves up so the RPC loop below
  // covers just the tail.
  let start = fromBlock;
  const bs = await blockscoutLogs(address);
  if (bs) {
    for (const r of bs.rows) {
      if (r.blockNumber >= fromBlock && r.blockNumber <= toBlock) raw.push(r);
    }
    // Resume one block after the newest block the explorer knows about. If it
    // returned nothing we cannot tell "no events" from "not indexed", so only
    // trust maxBlock when it actually saw something.
    if (bs.maxBlock > start) start = bs.maxBlock + BigInt(1);
  }

  // Some RPCs silently CAP the number of returned logs instead of erroring — a
  // near-cap return is treated as possible truncation: shrink and re-query the
  // same window rather than advancing past logs we may not have seen. (The
  // season builder's weightOf/totalWeight reconciliation is the hard backstop;
  // this just avoids relying on it for the common case.)
  const SUSPECT_CAP = 9_000;
  let step = initialStep;
  try {
    while (start <= toBlock) {
      const end = start + step - BigInt(1) > toBlock ? toBlock : start + step - BigInt(1);
      try {
        const logs = await client.getLogs({ address, events: EVENTS, fromBlock: start, toBlock: end });
        if (logs.length >= SUSPECT_CAP && step > BigInt(1)) { step = step / BigInt(2); continue; } // possible silent cap: shrink, don't advance.
        for (const l of logs) {
          raw.push({
            blockNumber: l.blockNumber!,
            logIndex: l.logIndex!,
            eventName: l.eventName as string,
            args: l.args as { user?: `0x${string}`; amount?: bigint; stakedAfter?: bigint },
          });
        }
        start = end + BigInt(1);
      } catch (err) {
        if (step > BigInt(1)) { step = step / BigInt(2); continue; } // range too large: shrink and retry.
        throw err;
      }
    }
  } catch (err) {
    // The tail is a BEST EFFORT once Blockscout has supplied history. No RPC
    // reachable from the Worker will serve eth_getLogs — the public one rate-
    // limits Cloudflare, Alchemy's free tier refuses every span — so treating a
    // failed tail as fatal took the whole feature down rather than costing it
    // the last few minutes of events. Degrade instead: serve the explorer's
    // history and let the next scan pick the tail up once it indexes.
    //
    // Only tolerable BECAUSE Blockscout succeeded. With no history at all this
    // still throws, so a genuine outage is never mistaken for "no stakers".
    if (!bs) throw err;
    console.warn(
      `[season/fetch] tail scan from ${start} failed, serving Blockscout history to ${bs.maxBlock}:`,
      err instanceof Error ? err.message.split("\n")[0] : err,
    );
  }

  raw.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

  // Resolve block timestamps once per unique block — but ONLY for rows that
  // arrived without one. Blockscout carries block_timestamp inline, so on the
  // fast path this loop usually does nothing at all.
  const tsCache = new Map<bigint, bigint>();
  for (const r of raw) if (r.ts !== undefined) tsCache.set(r.blockNumber, r.ts);
  const missing = [...new Set(raw.filter((r) => r.ts === undefined).map((r) => r.blockNumber))];
  for (const bn of missing) {
    const blk = await client.getBlock({ blockNumber: bn });
    tsCache.set(bn, blk.timestamp);
  }

  return raw.map((r) => ({
    kind: kindOf[r.eventName],
    user: r.args.user!,
    amount: r.args.amount ?? BigInt(0),
    stakedAfter: r.args.stakedAfter,
    ts: tsCache.get(r.blockNumber)!,
  }));
}
