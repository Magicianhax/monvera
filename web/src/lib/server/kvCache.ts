import "server-only";

// Two-layer server cache: per-isolate memory in front, Cloudflare KV behind.
//
// Cloudflare recycles isolates constantly, and the memory-only cache meant each
// cold one repaid the full cost of whatever it guarded — for Vera's on-chain
// record scan that was up to ~60s of Blockscout pagination or a chunked RPC
// sweep, felt by whichever user landed first. KV is shared across isolates and
// regions, so the scan happens once per TTL for the whole deployment.
//
// Semantics match executorLogs' old `cached()`, extended across the fleet:
//   - fresh (memory or KV, younger than ttl): served as-is
//   - stale: one refresh attempt; on failure the stale value is served, because
//     a data-source blip must never blank data we already have
//   - KV missing/broken (misconfig, local tooling): memory-only, never a crash
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { after } from "next/server";

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null; // outside a CF context (plain node scripts, some build steps)
  }
}

// VeraRecord rows carry bigints, which JSON.stringify rejects — tag them.
function pack(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { __bi: v.toString() } : v));
}
function unpack<T>(raw: string): T {
  return JSON.parse(raw, (_k, v) =>
    v && typeof v === "object" && typeof (v as { __bi?: unknown }).__bi === "string"
      ? BigInt((v as { __bi: string }).__bi)
      : v,
  ) as T;
}

interface Entry {
  at: number;
  data: unknown;
}

const memory = new Map<string, Entry>();
// One refresh per key per isolate at a time — a burst of stale readers must not
// fan out into parallel scans.
const inflight = new Map<string, Promise<void>>();
// Keep stale KV entries around long enough to serve through an outage, but not
// forever (KV storage is billed and keys should die when a feature does).
const KV_RETENTION_S = 7 * 24 * 3600;

async function refresh<T>(key: string, store: KvNamespace | null, load: () => Promise<T>): Promise<T> {
  const data = await load();
  const entry: Entry = { at: Date.now(), data };
  memory.set(key, entry);
  if (store) {
    try {
      await store.put(key, pack(entry), { expirationTtl: KV_RETENTION_S });
    } catch {
      /* memory still holds it */
    }
  }
  return data;
}

/** Refresh behind the response so no reader ever waits on a revalidation. */
function refreshInBackground(key: string, store: KvNamespace | null, load: () => Promise<unknown>): void {
  if (inflight.has(key)) return;
  const task = refresh(key, store, load)
    .then(() => undefined)
    .catch(() => {
      /* stale keeps serving; next reader retries */
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  try {
    after(task); // keep the worker alive past the response (waitUntil)
  } catch {
    /* outside a request scope (build, scripts): the floating promise is fine */
  }
}

export async function kvCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();

  const hot = memory.get(key);
  if (hot && now - hot.at < ttlMs) return hot.data as T;

  // KV: another isolate may have refreshed more recently than we did.
  const store = kv();
  let kvEntry: Entry | null = null;
  if (store) {
    try {
      const raw = await store.get(key);
      if (raw) kvEntry = unpack<Entry>(raw);
    } catch {
      /* treat as a miss */
    }
    if (kvEntry && now - kvEntry.at < ttlMs) {
      memory.set(key, kvEntry);
      return kvEntry.data as T;
    }
  }

  // Stale-while-revalidate: with ANY previous value in hand, serve it now and
  // refresh behind the response. The expensive path (a full record scan when
  // Blockscout flakes) is never paid by a user again — only the very first
  // reader of a key ever waits.
  const stale = hot && (!kvEntry || hot.at >= kvEntry.at) ? hot : kvEntry;
  if (stale) {
    memory.set(key, stale);
    refreshInBackground(key, store, load);
    return stale.data as T;
  }

  return refresh(key, store, load);
}
