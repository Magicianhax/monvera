// /api/cron/digest — Vera's weekly notes: a deterministic recap for every user
// with an active autopilot (the audience whose accounts she manages on a
// schedule). Fired Mondays by the Cloudflare Cron Trigger (worker.ts). Zero
// inference cost: every line is composed from real data. Delivered twice —
// a notification AND a message from Vera in a dedicated chat thread, so the
// agent visibly comes back to the user.
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { listActiveAutopilots, listRuns } from "@/lib/server/autopilotStore";
import { listRecentUsers } from "@/lib/server/userDirectory";
import { addNotification } from "@/lib/server/notifyStore";
import { listThreads, createThread, appendMessage } from "@/lib/server/veraChatStore";
import { getManyHistories } from "@/lib/server/marketData";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { CADENCE_LABEL } from "@/lib/autopilot";
import { usd } from "@/lib/format";
import { STAKING_ADDRESSES, seasonDistributorAbi, stakingClient } from "@/lib/staking";
import { leafOf, verifyProof } from "@/lib/season/compute";
import type { ClaimManifest } from "@/lib/season/claim";

export const dynamic = "force-dynamic";

const DIGEST_THREAD_TITLE = "Vera's weekly notes";

const ZERO_ROOT = `0x${"0".repeat(64)}`;
const WAD = BigInt(10) ** BigInt(18);

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

/** address (lowercased) → open (unclaimed, unexpired) season rewards, summed
 *  across seasons, with the soonest pinned deadline. Built ONCE per sweep so
 *  the per-user work in the loops below is a map lookup. Same trust model as
 *  the claim UI (useStaking's readClaims): every manifest entry must prove into
 *  the ON-CHAIN root before it is ever mentioned to a user. Best-effort by
 *  design — any failure returns what was gathered and the digest ships without
 *  the reminder. */
async function openSeasonRewards(): Promise<Map<string, { amount: bigint; deadline: number }>> {
  const out = new Map<string, { amount: bigint; deadline: number }>();
  try {
    const A = STAKING_ADDRESSES;
    const count = Number(
      await stakingClient.readContract({ address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "seasonCount" }),
    );
    if (count === 0) return out;

    // Manifests are static assets on our own origin, and a Worker cannot fetch
    // its own public URL (Cloudflare's recursion guard) — go through the self
    // service binding, exactly like cron/balances does. An absolute
    // NEXT_PUBLIC_CLAIM_BASE_URL (R2/CDN) fetches normally.
    const base = (process.env.NEXT_PUBLIC_CLAIM_BASE_URL ?? "/seasons").replace(/\/$/, "");
    const env = getCloudflareContext().env as { WORKER_SELF_REFERENCE?: { fetch: typeof fetch } };
    const fetchJson = base.startsWith("http") ? fetch : env.WORKER_SELF_REFERENCE?.fetch.bind(env.WORKER_SELF_REFERENCE);
    if (!fetchJson) return out;

    const nowSec = Date.now() / 1000;
    for (let id = 0; id < count; id++) {
      const season = (await stakingClient.readContract({
        address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "seasons", args: [BigInt(id)],
      })) as readonly [`0x${string}`, bigint, bigint, bigint];
      const root = season[0];
      const deadline = Number(season[3]);
      if (!root || root === ZERO_ROOT) continue; // season not opened on-chain yet
      if (deadline > 0 && nowSec > deadline) continue; // expired — nothing actionable left
      const url = `${base.startsWith("http") ? base : `https://monvera.best${base}`}/season-${id}.json`;
      const res = await fetchJson(url).catch(() => null);
      if (!res?.ok) continue; // manifest not published yet — normal pre-close state
      const manifest = (await res.json()) as ClaimManifest;
      // hasClaimed reads fire together so the client's multicall folds them.
      const checked = await Promise.all(
        Object.entries(manifest.claims ?? {}).map(async ([addr, entry]) => {
          let amount: bigint;
          try { amount = BigInt(entry.amount); } catch { return null; }
          if (amount <= BigInt(0)) return null;
          const account = addr as `0x${string}`;
          if (!verifyProof(leafOf(BigInt(id), account, amount), entry.proof, root)) return null;
          const claimed = (await stakingClient.readContract({
            address: A.seasonDistributor, abi: seasonDistributorAbi, functionName: "hasClaimed", args: [BigInt(id), account],
          })) as boolean;
          return claimed ? null : { address: addr.toLowerCase(), amount };
        }),
      );
      for (const hit of checked) {
        if (!hit) continue;
        const prev = out.get(hit.address);
        out.set(hit.address, {
          amount: (prev?.amount ?? BigInt(0)) + hit.amount,
          // Soonest pinned deadline wins; 0 = no window on any contributing season.
          deadline: !prev ? deadline : prev.deadline === 0 ? deadline : deadline === 0 ? prev.deadline : Math.min(prev.deadline, deadline),
        });
      }
    }
  } catch (e) {
    // The reminder is a bonus on top of the digest — never let it block the sweep.
    console.error("[digest] season rewards check failed:", e instanceof Error ? e.message : e);
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });

  const configs = await listActiveAutopilots();
  const pulse = await weekPulse();
  // Fetched once — the pulse loop and the rewards pass share the same audience.
  const everyone = await listRecentUsers(30).catch(() => []);
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

  // Season-rewards reminder: claims EXPIRE (deadline, then sweep), and until
  // now they were only visible inside the Staking page. One nudge per run to
  // every user whose wallet still has an open claim — the cron's weekly cadence
  // IS the dedupe, so no read-back is needed.
  let rewardsSent = 0;
  const rewardByAddress = await openSeasonRewards();
  if (rewardByAddress.size > 0) {
    // userId → EOA (lowercased). Autopilot configs carry the owner EOA; the
    // directory covers everyone else Vera has seen sign in recently.
    const audience = new Map<string, string>();
    for (const cfg of configs) audience.set(cfg.userId, cfg.owner.toLowerCase());
    for (const u of everyone) if (!audience.has(u.userId)) audience.set(u.userId, u.address.toLowerCase());
    for (const [userId, address] of audience) {
      const open = rewardByAddress.get(address);
      if (!open) continue;
      try {
        const amount = Number(open.amount / WAD).toLocaleString("en-US");
        const when = open.deadline > 0
          ? ` — claim before ${new Date(open.deadline * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
          : "";
        await addNotification(userId, {
          kind: "system",
          title: "Season rewards to claim",
          body: `You have ${amount} $MONVERA in season rewards to claim${when}.`,
          at: Date.now(),
        });
        rewardsSent++;
      } catch (e) {
        console.error("[digest] rewards user failed:", userId, e instanceof Error ? e.message : e);
      }
    }
  }

  return Response.json({ ok: true, sent, pulseSent, rewardsSent, of: configs.length });
}
