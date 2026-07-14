// /api/cron/alerts — sweep active price alerts against live prices and turn
// hits into notifications. Fired by the Cloudflare Cron Trigger (worker.ts).
// Auth: same bearer-secret scheme as the autopilot cron.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createPublicClient, http } from "viem";
import { activeAlerts, claimTriggered, addNotification } from "@/lib/server/notifyStore";
import { priceAllWithFallback } from "@/lib/server/pricing";
import { getDaySummary } from "@/lib/server/marketData";
import { ALL_ASSETS } from "@/lib/tokens";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { displayFor } from "@/lib/displayAssets";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

// Constant-time compare — the secret is shared with /api/cron/autopilot (which
// moves money), so a timing oracle here would leak the key for that route too.
function authed(req: NextRequest): boolean {
  const secret = process.env.AUTOPILOT_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  try {
    const alerts = await activeAlerts();
    if (alerts.length === 0) return Response.json({ ok: true, checked: 0, fired: 0 });
    // Live spots: Chainlink feeds, then a live Arcus quote for the feedless
    // majority, then Yahoo close (day summary spark) as the last resort —
    // mirroring how the app itself prices feedless assets.
    const wanted = new Set(alerts.map((a) => a.symbol));
    const assets = ALL_ASSETS.filter((a) => wanted.has(a.symbol));
    const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });
    const [feeds, summary] = await Promise.all([priceAllWithFallback(client, assets), getDaySummary()]);
    const prices: Record<string, number | undefined> = {};
    for (const sym of wanted) {
      const feed = feeds[sym]?.priceUsd;
      const spark = summary[sym]?.spark;
      prices[sym] = feed ?? (spark && spark.length ? spark[spark.length - 1] : undefined);
    }
    const now = Math.floor(Date.now() / 1000);
    let fired = 0;
    for (const a of alerts) {
      const price = prices[a.symbol];
      if (!price || price <= 0) continue;
      const hit = a.direction === "above" ? price >= a.threshold : price <= a.threshold;
      if (!hit) continue;
      // claim first so overlapping sweeps can't double-notify
      if (!(await claimTriggered(a.id, now))) continue;
      const name = displayFor(a.symbol).name;
      await addNotification(a.userId, {
        kind: "alert",
        title: `${name} is ${a.direction === "above" ? "above" : "below"} ${usd(a.threshold)}`,
        body: `${a.symbol} is trading at ${usd(price)} right now. This alert has been turned off; set a new one any time.`,
        symbol: a.symbol,
        at: now,
      });
      fired++;
    }
    return Response.json({ ok: true, checked: alerts.length, fired });
  } catch (err) {
    console.error("[cron/alerts]", err instanceof Error ? err.message : err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
