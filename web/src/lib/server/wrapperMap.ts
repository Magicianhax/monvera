import "server-only";

// Arcus RFQ fills deliver a WRAPPED token (wXLK, wSOXX, …) that auto-unwraps
// into the real asset within ~1-15 min. During that window the user's money sits
// at a wrapper address the portfolio didn't know about — so their balance looked
// gone. This module maintains the wrapper -> underlying map so the portfolio can
// count wrapped balances as "settling" holdings.
//
// The map is SELF-POPULATING: every RFQ submit response reports `settledToken`
// (the wrapper actually delivered). We verify it on-chain via its `underlying()`
// view against our asset universe, then persist it to KV (shared fleet-wide,
// no expiry — wrapper contracts are immutable). Two known wrappers are seeded so
// the feature works before the first post-deploy trade.
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { chain } from "@/lib/chain";
import { ALL_ASSETS, USDG } from "@/lib/tokens";
import { SERVER_RPC_URL } from "@/lib/server/rpc";

const KV_KEY = "wrapper-map:v1";

// Observed on-chain (settle txs), verified via underlying():
//   wXLK  -> XLK,  wSOXX -> SOXX
const SEEDS: Record<string, string> = {
  "0x73e2e3a3afd270fd9b0161a54377c19c09e5d719": "0x15cd20759ce7f3285c29a319de2d1a2e098c6f43",
  "0xfa05aa7b025be497906628a7584f03578e35eece": "0x75742c18bc1f1c5c5f448f4c9d9c6f66dafaaa38",
};

const UNDERLYING_ABI = parseAbi(["function underlying() view returns (address)"]);

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null;
  }
}

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

// Per-isolate memory copy (wrapper contracts are immutable, so stale is fine;
// KV is re-read on a timer only to pick up wrappers discovered by other isolates).
let memory: Record<string, string> | null = null;
let memoryAt = 0;
const MEMORY_TTL_MS = 5 * 60_000;

async function load(): Promise<Record<string, string>> {
  const now = Date.now();
  if (memory && now - memoryAt < MEMORY_TTL_MS) return memory;
  let stored: Record<string, string> = {};
  const store = kv();
  if (store) {
    try {
      const raw = await store.get(KV_KEY);
      if (raw) stored = JSON.parse(raw) as Record<string, string>;
    } catch {
      /* seeds still apply */
    }
  }
  memory = { ...SEEDS, ...stored };
  memoryAt = now;
  return memory;
}

export interface WrapperEntry {
  /** The wrapped token's address (holds the user's balance while settling). */
  wrapper: Address;
  /** The real asset it unwraps into. */
  underlying: Address;
}

/** Every known wrapper -> underlying pair (seeds + everything discovered). */
export async function getWrapperEntries(): Promise<WrapperEntry[]> {
  const map = await load();
  return Object.entries(map).map(([wrapper, underlying]) => ({
    wrapper: wrapper as Address,
    underlying: underlying as Address,
  }));
}

/**
 * Learn a wrapper from an RFQ submit's `settledToken`. Verified on-chain: the
 * token must expose underlying() pointing at one of OUR assets before it's
 * stored, so a hostile value can't poison the map. Fire-and-forget — failures
 * only mean the wrapper is learned on a later trade.
 */
export async function recordSettledToken(token: Address | null): Promise<void> {
  if (!token) return;
  const key = token.toLowerCase();
  const map = await load();
  if (map[key]) return; // already known
  // USDG (sell proceeds) has its own wrapper too — accept any known asset OR cash.
  let underlying: string;
  try {
    underlying = (
      await client.readContract({ address: token, abi: UNDERLYING_ABI, functionName: "underlying" })
    ).toLowerCase();
  } catch {
    return; // not a wrapper (or not ours) — ignore
  }
  const known =
    ALL_ASSETS.some((a) => a.address && a.address.toLowerCase() === underlying) ||
    USDG.address.toLowerCase() === underlying;
  if (!known) return;
  const next = { ...map, [key]: underlying };
  memory = next;
  memoryAt = Date.now();
  const store = kv();
  if (store) {
    try {
      // No expiry: wrapper contracts are immutable and the map is tiny.
      await store.put(KV_KEY, JSON.stringify(next));
    } catch {
      /* memory still holds it; another isolate will persist eventually */
    }
  }
}
