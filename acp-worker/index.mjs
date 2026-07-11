// Monvera ACP seller worker — fulfils paid `buildPortfolioPlan` jobs on the
// Virtuals Agent Commerce Protocol (Base). Flow per job:
//   REQUEST     -> validate the requirement, accept (or reject with a reason)
//   TRANSACTION -> buyer has paid: call Vera's plan endpoint, deliver the JSON
//
// The brain stays server-side at monvera.best (/api/agent/plan, shared-key
// auth); this process is a thin, stateless bridge and holds NO user funds —
// the wallet key here is the whitelisted ACP dev wallet, used only to sign
// job memos for Vera's registered agent wallet.
//
// Run: node index.mjs   (env in .env — see .env.example)
import "dotenv/config";
import AcpClient, { AcpContractClientV2, AcpJobPhases } from "@virtuals-protocol/acp-node";

const {
  WHITELISTED_WALLET_PRIVATE_KEY,
  SELLER_ENTITY_ID,
  SELLER_AGENT_WALLET_ADDRESS,
  ACP_RPC_URL, // optional custom Base RPC
  MONVERA_PLAN_URL = "https://monvera.best/api/agent/plan",
  ACP_PLAN_KEY,
} = process.env;

for (const [k, v] of Object.entries({ WHITELISTED_WALLET_PRIVATE_KEY, SELLER_ENTITY_ID, SELLER_AGENT_WALLET_ADDRESS, ACP_PLAN_KEY })) {
  if (!v) {
    console.error(`[worker] missing env ${k} — copy .env.example to .env and fill it.`);
    process.exit(1);
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── requirement parsing ───────────────────────────────────────────────────────
// Buyers send the job requirement either as an object ({ goal, budgetUsd,
// riskTolerance }) or as loose text. Be liberal in what we accept, strict in
// what we forward.
function parseRequirement(raw) {
  let goal = "";
  let amountUsd;
  let riskTolerance;
  if (raw && typeof raw === "object") {
    goal = String(raw.goal ?? raw.request ?? raw.prompt ?? raw.description ?? "").trim();
    const amt = Number(raw.budgetUsd ?? raw.amountUsd ?? raw.budget);
    if (Number.isFinite(amt) && amt > 0) amountUsd = Math.min(amt, 1_000_000);
    if (typeof raw.riskTolerance === "string") riskTolerance = raw.riskTolerance.slice(0, 40);
    else if (typeof raw.risk === "string") riskTolerance = raw.risk.slice(0, 40);
  } else if (typeof raw === "string") {
    goal = raw.trim();
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
  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      WHITELISTED_WALLET_PRIVATE_KEY,
      SELLER_ENTITY_ID,
      SELLER_AGENT_WALLET_ADDRESS,
      ...(ACP_RPC_URL ? [ACP_RPC_URL] : []),
    ),
    onNewTask: async (job, memoToSign) => {
      try {
        if (job.phase === AcpJobPhases.REQUEST && memoToSign?.nextPhase === AcpJobPhases.NEGOTIATION) {
          const { goal } = parseRequirement(job.requirement);
          if (goal.length < 4) {
            log(`job ${job.id}: rejecting — no usable goal in requirement`, job.requirement);
            await job.reject("Requirement must include a goal in plain words, e.g. { \"goal\": \"grow $300, mostly big tech\" }");
            return;
          }
          log(`job ${job.id}: accepting — goal: "${goal.slice(0, 80)}"`);
          await job.accept("Goal received. Vera will build the plan on payment.");
          await job.createRequirement(`Job ${job.id} accepted, please make payment to proceed`);
        } else if (job.phase === AcpJobPhases.TRANSACTION && memoToSign?.nextPhase === AcpJobPhases.EVALUATION) {
          log(`job ${job.id}: paid — generating plan`);
          const plan = await generatePlan(job.requirement);
          await job.deliver({ type: "object", value: plan });
          log(`job ${job.id}: delivered (${plan.allocations?.length ?? 0} holdings, risk ${plan.riskScore ?? "n/a"})`);
        }
      } catch (err) {
        log(`job ${job.id}: ERROR`, err?.message ?? err);
        // Never leave a paid job hanging silently: refuse with a reason so the
        // buyer's escrow can resolve instead of timing out.
        try {
          await job.reject(`Could not produce the plan: ${String(err?.message ?? err).slice(0, 160)}`);
        } catch {
          /* rejection after failure is best-effort */
        }
      }
    },
  });

  await acpClient.init();
  log(`seller online — agent ${SELLER_AGENT_WALLET_ADDRESS}, plan endpoint ${MONVERA_PLAN_URL}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
