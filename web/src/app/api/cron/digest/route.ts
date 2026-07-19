// /api/cron/digest — Vera's weekly notes: a deterministic recap for every user
// with an active autopilot (the audience whose accounts she manages on a
// schedule). Fired Mondays by the Cloudflare Cron Trigger (worker.ts). Zero
// inference cost: every line is composed from real data. Delivered twice —
// a notification AND a message from Vera in a dedicated chat thread, so the
// agent visibly comes back to the user.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listActiveAutopilots, listRuns } from "@/lib/server/autopilotStore";
import { listRecentUsers } from "@/lib/server/userDirectory";
import { addNotification } from "@/lib/server/notifyStore";
import { listThreads, createThread, appendMessage } from "@/lib/server/veraChatStore";
import { getManyHistories } from "@/lib/server/marketData";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { CADENCE_LABEL } from "@/lib/autopilot";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

const DIGEST_THREAD_TITLE = "Vera's weekly notes";

function authed(req: NextRequest): boolean {
  const secret = process.env.AUTOPILOT_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Week leaders/laggards across the buyable universe — computed once per sweep. */
async function weekPulse(): Promise<string> {
  try {
    const symbols = ALL_ASSETS.filter((a) => !displayFor(a.symbol).coming).map((a) => a.symbol);
    const hist = await getManyHistories(symbols, "1W");
    const moves: { sym: string; pct: number }[] = [];
    // getManyHistories returns a Map — Object.entries() on it yields nothing,
    // which silently blanked this section on every digest ever sent.
    for (const [sym, h] of hist) {
      const s = h?.series;
      if (s && s.length > 1 && s[0] > 0) moves.push({ sym, pct: ((s[s.length - 1] - s[0]) / s[0]) * 100 });
    }
    if (moves.length < 4) return "";
    moves.sort((a, b) => b.pct - a.pct);
    const up = moves.slice(0, 3).map((m) => `${m.sym} +${m.pct.toFixed(1)}%`).join(", ");
    const down = moves.slice(-3).reverse().map((m) => `${m.sym} ${m.pct.toFixed(1)}%`).join(", ");
    return `This week in the market: ${up} led; ${down} lagged.`;
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });

  const configs = await listActiveAutopilots();
  const pulse = await weekPulse();
  const weekAgo = Date.now() / 1000 - 7 * 86400;
  let sent = 0;

  for (const cfg of configs) {
    try {
      const runs = await listRuns(cfg.userId, 20);
      const recent = runs.filter((r) => r.ranAt >= weekAgo);
      const okRuns = recent.filter((r) => r.status === "success");
      const invested = okRuns.reduce((s, r) => s + (r.amountUsd ?? 0), 0);

      const lines = [
        okRuns.length > 0
          ? `Autopilot ran ${okRuns.length} ${okRuns.length === 1 ? "time" : "times"} this week and invested ${usd(invested)} for you (${usd(cfg.amountUsd)} ${CADENCE_LABEL[cfg.cadence].toLowerCase()}).`
          : `Autopilot is on (${usd(cfg.amountUsd)} ${CADENCE_LABEL[cfg.cadence].toLowerCase()}) — no runs landed this week.`,
        pulse,
        "Full details are in Activity; nudge me any time to change course.",
      ].filter(Boolean);
      const body = lines.join("\n");

      // 1) inbox notification
      await addNotification(cfg.userId, { kind: "system", title: "Your week at Monvera", body: lines[0], at: Date.now() });

      // 2) a message from Vera in the dedicated weekly thread
      const threads = await listThreads(cfg.userId);
      const existing = threads.find((t) => t.title === DIGEST_THREAD_TITLE);
      const thread = existing ?? (await createThread(cfg.userId, DIGEST_THREAD_TITLE));
      await appendMessage(cfg.userId, thread.id, { role: "vera", kind: "text", content: body });

      sent++;
    } catch (e) {
      // one user failing never blocks the sweep
      console.error("[digest] user failed:", cfg.userId, e instanceof Error ? e.message : e);
    }
  }

  // Fleet-wide half: everyone seen recently who ISN'T on autopilot still gets
  // the market-pulse brief — deterministic, zero inference, safe at scale.
  let pulseSent = 0;
  if (pulse) {
    const autopilotIds = new Set(configs.map((c) => c.userId));
    const everyone = await listRecentUsers(30).catch(() => []);
    for (const u of everyone) {
      if (autopilotIds.has(u.userId)) continue;
      try {
        const body = [pulse, "Want in on the moves? Tell me a goal, or say \"invest on autopilot\" and I'll handle the cadence."].join("\n");
        await addNotification(u.userId, { kind: "system", title: "This week in the market", body: pulse, at: Date.now() });
        const threads = await listThreads(u.userId);
        const existing = threads.find((t) => t.title === DIGEST_THREAD_TITLE);
        const thread = existing ?? (await createThread(u.userId, DIGEST_THREAD_TITLE));
        await appendMessage(u.userId, thread.id, { role: "vera", kind: "text", content: body });
        pulseSent++;
      } catch (e) {
        console.error("[digest] pulse user failed:", u.userId, e instanceof Error ? e.message : e);
      }
    }
  }

  return Response.json({ ok: true, sent, pulseSent, of: configs.length });
}
