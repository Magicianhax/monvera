import "server-only";

// Does the auto-manage pass still work? Nothing else asks.
//
// Every failure INSIDE a window now pages the owner (see fail() in
// autoRebalance.ts). This watches the failures that leave no window at all, or
// that look healthy row by row:
//
//   1. The cron stopped firing. Windows are every 6h, so nothing recorded in 7h
//      means the schedule, the Worker, or the service binding is broken — and by
//      construction the pass cannot report its own absence.
//   2. The last window recorded an error string.
//   3. A grove has produced nothing but outage outcomes for several windows.
//      Each such row is individually honest ("Vera couldn't complete her market
//      check"), which is exactly why a sustained provider failure could defer
//      every window indefinitely with nobody told. CLAUDE.md rule 10 records
//      that shape reaching production once already.
//
// Deliberately NOT here: anything the pass itself can see and page about. This
// is the outside view, and it is the only one that survives the pass not running.
import { latestRuns, outageStreak } from "./rebalanceStore";
import { GROVES } from "@/lib/groves";
import { alertOwner } from "./ownerAlert";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Windows are 6h apart; 7h is one missed window plus slack for a late run. */
const SILENCE_MS = 7 * 3600 * 1000;
/** Consecutive all-outage windows before this is an incident rather than a blip.
 *  Three is 18h — long enough that a transient provider wobble has passed. */
const OUTAGE_STREAK_ALERT = 3;
/** The watchdog runs every 15 minutes. Without dedup a single stuck condition
 *  would page 96 times a day, which trains the owner to ignore the inbox — the
 *  precise failure this exists to prevent. One page per condition per 6h. */
const REPAGE_TTL_S = 6 * 3600;

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as unknown as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null;
  }
}

/** True when this exact condition has not paged recently. FAIL OPEN: if KV is
 *  unreachable we page rather than stay silent — a duplicate alert is a
 *  nuisance, a suppressed one is the bug we are watching for. */
async function claimPage(key: string): Promise<boolean> {
  const store = kv();
  if (!store) return true;
  try {
    if (await store.get(key)) return false;
    await store.put(key, "1", { expirationTtl: REPAGE_TTL_S });
    return true;
  } catch {
    return true;
  }
}

export interface WatchdogReport {
  checked: boolean;
  alerts: string[];
}

/** Never throws: a watchdog that can take down the cron it rides on is worse
 *  than no watchdog. */
export async function runRebalanceWatchdog(now = Date.now()): Promise<WatchdogReport> {
  const alerts: string[] = [];
  try {
    const runs = await latestRuns(3);

    // 1. Silence. No rows at all is the same signal as a stale newest row: the
    //    pass is not reaching the ledger.
    const newest = runs[0];
    const age = newest ? now - newest.startedAt : Number.POSITIVE_INFINITY;
    if (age > SILENCE_MS) {
      const detail = newest
        ? `The last auto-manage window started ${(age / 3600000).toFixed(1)}h ago (${new Date(newest.startedAt).toISOString()}). Windows are every 6h, so at least one has not run.`
        : "No auto-manage window has ever been recorded. The cron, the Worker, or the D1 binding is not wired up.";
      if (await claimPage("watchdog:silence")) {
        await alertOwner("no rebalance window recorded", detail);
        alerts.push("silence");
      }
    }

    // 2. The last window recorded an error.
    if (newest?.error) {
      if (await claimPage(`watchdog:runerror:${newest.runId}`)) {
        await alertOwner("last rebalance window reported an error", `${newest.runId}: ${newest.error}`);
        alerts.push("run-error");
      }
    }

    // 3. Sustained outage per grove.
    for (const g of GROVES) {
      if (g.onChainId === undefined) continue;
      const streak = await outageStreak(g.id);
      if (streak >= OUTAGE_STREAK_ALERT) {
        if (await claimPage(`watchdog:outage:${g.id}`)) {
          await alertOwner(
            `${g.name} has not been managed for ${streak} windows`,
            `Every outcome for the last ${streak} windows was an outage (model unreachable or prices unavailable), so the basket is drifting untouched. Each row reads honestly on its own, which is why this needed watching from outside. Check the model provider and the pricing sweep.`,
          );
          alerts.push(`outage:${g.id}`);
        }
      }
    }
    return { checked: true, alerts };
  } catch (err) {
    console.error("[rebalance-watchdog]", err instanceof Error ? err.message : err);
    return { checked: false, alerts };
  }
}
