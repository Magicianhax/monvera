import "server-only";

// KV index of who holds what, written by the hourly balances cron out of data
// it already fetched (zero new RPC). The news sweep uses it to fetch feeds for
// held symbols instead of the whole 96-asset universe.
//
// NARROWING DEVICE ONLY. Nothing a user ever reads takes a dollar figure from
// here — the alert's exposure number is read from the chain at send time — so a
// stale or missing index can waste a fetch but can never produce a wrong number.
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** Raw KV, autoRebalance's pattern: null outside a CF context, callers decide policy. */
function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null;
  }
}

const UNION_KEY = "news:held-union";
/** One hour past the write cadence, so a single failed balances cron does not
 *  blank the index. */
const TTL_S = 26 * 3600;

export async function putHoldings(address: string, rows: { symbol: string; usd: number }[]): Promise<void> {
  try {
    await kv()?.put(
      `news:holdings:${address.toLowerCase()}`,
      JSON.stringify({ at: Date.now(), rows }),
      { expirationTtl: TTL_S },
    );
  } catch {
    /* best-effort index; never costs the caller its primary job */
  }
}

export async function putHeldUnion(symbols: string[]): Promise<void> {
  try {
    await kv()?.put(
      UNION_KEY,
      JSON.stringify({ at: Date.now(), symbols: [...new Set(symbols)].sort() }),
      { expirationTtl: TTL_S },
    );
  } catch {
    /* best-effort */
  }
}

/** Every symbol some user held at the last snapshot. [] on miss, parse failure
 *  or KV absence — the sweep treats an empty union as a cold start. */
export async function heldUnion(): Promise<string[]> {
  try {
    const raw = await kv()?.get(UNION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { symbols?: unknown };
    return Array.isArray(parsed.symbols) ? parsed.symbols.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}
