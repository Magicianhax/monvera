// /api/cron/balances — hourly balance snapshot for every known user, the data
// behind the real equity curve. Values each address through the SAME code as
// /api/portfolio (self-invoked via the worker service binding, so wrapper-map
// settling, MONVERA pricing, and every future valuation fix apply here for
// free), then appends one row per address per hour. Fired hourly (worker.ts).
// Auth: same bearer-secret scheme as the other crons.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { listRecentUsers } from "@/lib/server/userDirectory";
import { putSnapshot, pruneSnapshots } from "@/lib/server/balanceSnapshots";
import { unauthorized, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const secret = process.env.AUTOPILOT_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface PortfolioBody {
  cashUsd?: number;
  /** Grove-exit USDG at the smart account — cash, just not EOA-spendable. */
  smartCashUsd?: number;
  investedUsd?: number;
  totalUsd?: number;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return unauthorized();
  try {
    const users = await listRecentUsers(90, 500).catch(() => []);
    // One snapshot per EOA. Keep the smart account alongside (first non-null
    // wins) — grove baskets and grove-exit USDG live there, and /api/portfolio
    // only values them when `smart` is passed. Rows recorded before migration
    // 0011 (or by clients that haven't reported it yet) have null and are
    // valued EOA-only, exactly as before.
    const ADDR = /^0x[a-fA-F0-9]{40}$/;
    const byAddress = new Map<string, string | null>();
    for (const u of users) {
      const address = u.address.toLowerCase();
      const smart = u.smartAddress && ADDR.test(u.smartAddress) ? u.smartAddress.toLowerCase() : null;
      if (!byAddress.has(address) || (byAddress.get(address) === null && smart)) byAddress.set(address, smart);
    }
    const addresses = [...byAddress.keys()];
    if (addresses.length === 0) return Response.json({ snapped: 0, failed: 0, asOf: new Date().toISOString() });

    const env = getCloudflareContext().env as { WORKER_SELF_REFERENCE?: { fetch: typeof fetch } };
    const self = env.WORKER_SELF_REFERENCE;
    if (!self) return Response.json({ snapped: 0, failed: addresses.length, note: "no self binding" });

    const hour = Math.floor(Date.now() / 3600_000) * 3600;
    let snapped = 0;
    let failed = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < addresses.length; i += CONCURRENCY) {
      await Promise.all(
        addresses.slice(i, i + CONCURRENCY).map(async (address) => {
          try {
            const smart = byAddress.get(address);
            const res = await self.fetch(
              `https://monvera.best/api/portfolio?address=${address}${smart ? `&smart=${smart}` : ""}`,
            );
            if (!res.ok) throw new Error(`portfolio ${res.status}`);
            const p = (await res.json()) as PortfolioBody;
            if (typeof p.totalUsd !== "number") throw new Error("no totalUsd");
            // cash column = ALL the user's cash (EOA + grove-exit USDG at the
            // smart account), so cash + invested = total keeps holding.
            await putSnapshot(address, hour, (p.cashUsd ?? 0) + (p.smartCashUsd ?? 0), p.investedUsd ?? 0, p.totalUsd);
            snapped++;
          } catch (err) {
            failed++;
            console.error(`[cron-balances] ${address}:`, err instanceof Error ? err.message : err);
          }
        }),
      );
    }
    await pruneSnapshots(90).catch(() => {});
    return Response.json({ snapped, failed, asOf: new Date().toISOString() });
  } catch (err) {
    return serverError("cron-balances", err);
  }
}
