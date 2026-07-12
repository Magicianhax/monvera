// Monvera ACP seller worker — fulfils paid `buildPortfolioPlan` jobs on the
// Virtuals Agent Commerce Protocol (Base), using the v2 SDK + the dashboard's
// generated signer key (Signers > Add Signer, Virtuals-only policy).
//
// Lifecycle per job (v2 session state machine):
//   requirement message  -> validate the goal, set the budget from the
//                           registry offering (or reject with a reason)
//   job.funded           -> call Vera's plan endpoint, session.submit(plan)
//   job.completed        -> done
//
// The brain stays server-side at monvera.best (/api/agent/plan, shared-key
// auth); this process is a thin, stateless bridge and holds NO user funds —
// the signer key only authorizes Virtuals wallet operations.
//
// Run: node index.mjs   (env in .env — see .env.example)
import "dotenv/config";
import { base } from "@account-kit/infra";
import { AcpAgent, AssetToken, PrivyAlchemyEvmProviderAdapter } from "@virtuals-protocol/acp-node-v2";

const {
  SELLER_WALLET_ADDRESS,
  SELLER_WALLET_ID,
  SELLER_SIGNER_PRIVATE_KEY,
  MONVERA_PLAN_URL = "https://monvera.best/api/agent/plan",
  ACP_PLAN_KEY,
} = process.env;

for (const [k, v] of Object.entries({ SELLER_WALLET_ADDRESS, SELLER_WALLET_ID, SELLER_SIGNER_PRIVATE_KEY, ACP_PLAN_KEY })) {
  if (!v) {
    console.error(`[worker] missing env ${k} — copy .env.example to .env and fill it.`);
    process.exit(1);
  }
}

const log = (...a) => console.log(new Date().toISOString(), "[seller]", ...a);

// ── requirement parsing ───────────────────────────────────────────────────────
// Buyers send the requirement as JSON ({ goal, budgetUsd, riskTolerance }) or
// as loose text. Be liberal in what we accept, strict in what we forward.
function parseRequirement(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { goal: raw };
    }
  }
  let goal = "";
  let amountUsd;
  let riskTolerance;
  if (data && typeof data === "object") {
    goal = String(data.goal ?? data.request ?? data.prompt ?? data.description ?? "").trim();
    const amt = Number(data.budgetUsd ?? data.amountUsd ?? data.budget);
    if (Number.isFinite(amt) && amt > 0) amountUsd = Math.min(amt, 1_000_000);
    if (typeof data.riskTolerance === "string") riskTolerance = data.riskTolerance.slice(0, 40);
    else if (typeof data.risk === "string") riskTolerance = data.risk.slice(0, 40);
  }
  goal = goal.slice(0, 600);
  return { goal, amountUsd, riskTolerance };
}

async function generatePlan(requirement) {
  const { goal, amountUsd, riskTolerance } = parseRequirement(requirement);
  if (goal.length < 4) throw new Error("requirement needs a goal in plain words (4+ characters)");
  const res = await fetch(MONVERA_PLAN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-key": ACP_PLAN_KEY },
    body: JSON.stringify({ goal, ...(amountUsd ? { amountUsd } : {}), ...(riskTolerance ? { riskTolerance } : {}) }),
  });
  if (!res.ok) throw new Error(`plan endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── the seller loop ───────────────────────────────────────────────────────────
async function main() {
  const seller = await AcpAgent.create({
    provider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: SELLER_WALLET_ADDRESS,
      walletId: SELLER_WALLET_ID,
      signerPrivateKey: SELLER_SIGNER_PRIVATE_KEY,
      chains: [base],
    }),
  });

  const sellerAddress = (await seller.getAddress()).toLowerCase();
  log(`address: ${sellerAddress}`);

  // Requirement payloads by jobId, so job.funded can read what the buyer asked
  // for even if the session object does not carry it directly.
  const sessionRequirements = new Map();

  // Price comes from the registry listing, never hardcoded. Snapshot at
  // startup; restart the worker after changing prices in the dashboard.
  let offeringsByName = new Map();
  try {
    const me = await seller.getAgentByWalletAddress(sellerAddress);
    offeringsByName = new Map((me?.offerings ?? []).map((o) => [o.name, o]));
    for (const o of offeringsByName.values()) log(`offering: ${o.name} — ${o.priceValue} USDC, sla ${o.slaMinutes}min`);
    if (offeringsByName.size === 0) log("WARNING: no offerings on the registry yet — save the buildPortfolioPlan listing in the dashboard.");
  } catch (err) {
    log("WARNING: could not load registry offerings:", err?.message ?? err);
  }

  seller.on("entry", async (session, entry) => {
    try {
      if (entry.kind === "system") {
        switch (entry.event.type) {
          case "job.created":
            log(`job ${session.jobId}: created by ${entry.event.client}`);
            break;
          case "job.funded": {
            log(`job ${session.jobId}: funded — generating plan`);
            try {
              const requirement = session.job?.requirement ?? session.requirement ?? sessionRequirements.get(session.jobId);
              const plan = await generatePlan(requirement);
              await session.sendMessage("Plan built from real 12-month market data. Delivering now.");
              await session.submit(JSON.stringify(plan));
              log(`job ${session.jobId}: delivered (${plan.allocations?.length ?? 0} holdings, risk ${plan.riskScore ?? "n/a"})`);
            } catch (err) {
              // Never leave a paid job hanging: reject with a reason so the
              // buyer's escrow resolves instead of timing out.
              log(`job ${session.jobId}: delivery FAILED:`, err?.message ?? err);
              await session.sendMessage(`Could not produce the plan: ${String(err?.message ?? err).slice(0, 200)}`);
              await session.reject("delivery failed");
            }
            break;
          }
          case "job.completed":
            log(`job ${session.jobId}: completed`);
            break;
          case "job.rejected":
            log(`job ${session.jobId}: rejected by ${entry.event.rejector}: ${entry.event.reason}`);
            break;
          case "job.expired":
            log(`job ${session.jobId}: expired`);
            break;
        }
        return;
      }

      // The buyer's first message carries the structured requirement.
      // `status === "open"` guard = idempotency against replayed entries.
      if (entry.kind === "message" && entry.contentType === "requirement" && session.status === "open") {
        const rejectWithDetail = async (tag, detail) => {
          log(`job ${session.jobId}: rejecting — ${detail}`);
          await session.sendMessage(detail);
          await session.reject(tag);
        };

        const offeringName = session.job?.description;
        if (!offeringName || !offeringsByName.has(offeringName)) {
          await rejectWithDetail("unsupported offering", `Offering "${offeringName ?? "?"}" is not served by this agent.`);
          return;
        }

        const { goal } = parseRequirement(entry.content);
        if (goal.length < 4) {
          await rejectWithDetail(
            "missing goal",
            'Requirement must include a goal in plain words, e.g. { "goal": "grow $300, mostly big tech" }.',
          );
          return;
        }

        sessionRequirements.set(session.jobId, entry.content);
        const offering = offeringsByName.get(offeringName);
        log(`job ${session.jobId}: goal "${goal.slice(0, 80)}" — setting budget ${offering.priceValue} USDC`);
        await session.setBudget(AssetToken.usdc(offering.priceValue, session.chainId));
      }
    } catch (err) {
      log(`job ${session.jobId}: handler error:`, err?.message ?? err);
    }
  });

  await seller.start();
  log(`ready — listening for jobs (plan endpoint: ${MONVERA_PLAN_URL})`);

  const shutdown = async (signal) => {
    log(`received ${signal}, shutting down`);
    await seller.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
