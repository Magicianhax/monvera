// /api/autopilot — manage the signed-in user's Autopilot config.
//   GET    → current config (or null)
//   POST   → create/update (also resets the schedule)
//   DELETE → turn it off
// Authed (Privy session). The actual autonomous execution lives in the cron route.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { verifyRequest, userOwnsWallet } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { getAutopilot, upsertAutopilot, deleteAutopilot } from "@/lib/server/autopilotStore";
import { AUTOPILOT_DEFAULTS, CADENCE_SECONDS, nextRunAfter, type AutopilotConfig } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

const addr = z.string().refine((a) => isAddress(a), "Invalid address.");
const ConfigInput = z.object({
  walletId: z.string().min(1), // Privy embedded-wallet id (server signs for this)
  owner: addr, // embedded EOA (smart-account owner)
  smartAccount: addr, // the AA address that holds funds + executes
  goal: z.string().min(1).max(600),
  amountUsd: z.number().positive().max(100_000),
  cadence: z.enum(["daily", "weekly", "biweekly", "monthly"]),
  riskCeilingBps: z.number().int().min(0).max(10_000).optional(),
  maxPerPeriodUsd: z.number().positive().max(1_000_000).optional(),
});

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  return Response.json({ autopilot: await getAutopilot(user.userId) });
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const limit = rateLimit(`autopilot:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof ConfigInput>;
  try {
    body = ConfigInput.parse(await req.json());
  } catch {
    return badRequest("Invalid autopilot settings.");
  }

  // Confused-deputy gate: the wallet being delegated must be the CALLER'S own
  // embedded wallet. Otherwise any signed-in user could register a victim's
  // walletId and have the cron spend from the victim's delegated wallet.
  if (!(await userOwnsWallet(user.userId, body.walletId, body.owner))) {
    return badRequest("That wallet does not belong to your account.");
  }

  try {
    // Clock at request time (allowed in a handler) — anchors the schedule.
    const now = Math.floor(Date.now() / 1000);
    const existing = await getAutopilot(user.userId);
    const cfg: AutopilotConfig = {
      id: existing?.id ?? `ap_${user.userId}`,
      userId: user.userId,
      walletId: body.walletId,
      owner: body.owner as `0x${string}`,
      smartAccount: body.smartAccount as `0x${string}`,
      goal: body.goal,
      amountUsd: body.amountUsd,
      cadence: body.cadence,
      riskCeilingBps: body.riskCeilingBps ?? AUTOPILOT_DEFAULTS.riskCeilingBps,
      maxPerPeriodUsd: body.maxPerPeriodUsd ?? body.amountUsd * AUTOPILOT_DEFAULTS.maxPerPeriodMultiplier,
      active: true,
      createdAt: existing?.createdAt ?? now,
      nextRunAt: nextRunAfter(now, body.cadence),
      runs: existing?.runs ?? 0,
      spentThisPeriod: 0,
    };
    return Response.json({ autopilot: await upsertAutopilot(cfg), cadenceSeconds: CADENCE_SECONDS[body.cadence] });
  } catch (err) {
    return serverError("autopilot", err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  try {
    // Same wrapping as POST — a store failure must surface as a structured 500,
    // because the client only believes autopilot is off on a 2xx. An unwrapped
    // throw here paired with a client that never checked res.ok once showed
    // "Autopilot is off" while the cron kept spending.
    await deleteAutopilot(user.userId);
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("autopilot", err);
  }
}
