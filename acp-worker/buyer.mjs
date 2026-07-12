// Sandbox test buyer — hires Vera's buildPortfolioPlan job once, evaluates
// the deliverable itself (self-evaluation), and exits. Needs a SECOND
// registered agent (the test buyer) with a little USDC on Base.
//
// Env (in .env): BUYER_WALLET_ADDRESS, BUYER_WALLET_ID,
// BUYER_SIGNER_PRIVATE_KEY, SELLER_WALLET_ADDRESS (Vera, already set).
//
// Run: node buyer.mjs
import "dotenv/config";
import { base } from "@account-kit/infra";
import { AcpAgent, PrivyAlchemyEvmProviderAdapter } from "@virtuals-protocol/acp-node-v2";

const { BUYER_WALLET_ADDRESS, BUYER_WALLET_ID, BUYER_SIGNER_PRIVATE_KEY, SELLER_WALLET_ADDRESS } = process.env;
for (const [k, v] of Object.entries({ BUYER_WALLET_ADDRESS, BUYER_WALLET_ID, BUYER_SIGNER_PRIVATE_KEY, SELLER_WALLET_ADDRESS })) {
  if (!v) {
    console.error(`[buyer] missing env ${k}`);
    process.exit(1);
  }
}

// Safety cap: never fund more than this in a test run.
const MAX_USDC = 0.05;

const REQUIREMENT = {
  goal: "grow $100 across steady tech and funds",
  budgetUsd: 100,
  riskTolerance: "balanced",
};

const log = (...a) => console.log(new Date().toISOString(), "[buyer]", ...a);

async function main() {
  const buyer = await AcpAgent.create({
    provider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: BUYER_WALLET_ADDRESS,
      walletId: BUYER_WALLET_ID,
      signerPrivateKey: BUYER_SIGNER_PRIVATE_KEY,
      chains: [base],
    }),
  });

  const buyerAddress = (await buyer.getAddress()).toLowerCase();
  log(`address: ${buyerAddress}`);

  buyer.on("entry", async (session, entry) => {
    try {
      if (entry.kind === "message" && entry.from.toLowerCase() !== buyerAddress) {
        log(`job ${session.jobId} seller says: ${String(entry.content).slice(0, 200)}`);
      }
      if (entry.kind !== "system") return;

      switch (entry.event.type) {
        case "budget.set": {
          const proposed = Number(entry.event.amount);
          log(`job ${session.jobId}: seller proposed ${proposed} USDC`);
          if (proposed > MAX_USDC) {
            await session.sendMessage(`Budget ${proposed} USDC exceeds test cap ${MAX_USDC}`);
            await session.reject("budget over test cap");
            return;
          }
          await session.fetchJob();
          await session.fund();
          log(`job ${session.jobId}: funded`);
          break;
        }
        case "job.submitted": {
          const deliverable = entry.event.deliverable;
          log(`job ${session.jobId}: DELIVERABLE RECEIVED`);
          try {
            const plan = JSON.parse(deliverable);
            log(`  allocations: ${plan.allocations?.map((a) => `${a.symbol} ${a.weightPct}%`).join(", ")}`);
            log(`  riskScore: ${plan.riskScore} | backtest: ${plan.backtest ? plan.backtest.returnPct + "% vs SPY" : "null"}`);
            const weightsOk = plan.allocations?.reduce((s, a) => s + a.weightPct, 0) === 100;
            log(`  weights sum to 100: ${weightsOk}`);
          } catch {
            log(`  (raw): ${String(deliverable).slice(0, 300)}`);
          }
          await session.complete("Evaluated: plan received and well-formed");
          break;
        }
        case "job.completed":
          log(`job ${session.jobId}: COMPLETED — full loop verified`);
          await buyer.stop();
          process.exit(0);
          break;
        case "job.rejected":
          log(`job ${session.jobId}: rejected by ${entry.event.rejector}: ${entry.event.reason}`);
          await buyer.stop();
          process.exit(1);
          break;
        case "job.expired":
          log(`job ${session.jobId}: expired`);
          await buyer.stop();
          process.exit(1);
          break;
      }
    } catch (err) {
      log(`job ${session.jobId}: handler error:`, err?.message ?? err);
    }
  });

  await buyer.start();

  // Don't pile new jobs on top of an in-flight one after a Ctrl+C restart.
  const inFlight = buyer.sessions.filter(
    (s) => s.chainId === base.id && s.roles.includes("client") && !["completed", "rejected", "expired"].includes(s.status),
  );
  if (inFlight.length > 0) {
    log(`resuming ${inFlight.length} in-flight job(s); not creating a new one`);
    return;
  }

  log(`looking up seller ${SELLER_WALLET_ADDRESS}`);
  const agent = await buyer.getAgentByWalletAddress(SELLER_WALLET_ADDRESS);
  if (!agent) {
    log("seller not found on the registry");
    await buyer.stop();
    process.exit(1);
  }
  const offering = agent.offerings.find((o) => o.name === "buildPortfolioPlan") ?? agent.offerings[0];
  if (!offering) {
    log("seller has no offerings");
    await buyer.stop();
    process.exit(1);
  }
  log(`hiring "${offering.name}" (${offering.priceValue} USDC) with goal: "${REQUIREMENT.goal}"`);

  const jobId = await buyer.createJobFromOffering(base.id, offering, agent.walletAddress, REQUIREMENT, {
    evaluatorAddress: buyerAddress, // self-evaluation: this script gates the deliverable
  });
  log(`job ${jobId} created — waiting for the seller`);
}

main().catch((err) => {
  console.error("[buyer] fatal:", err);
  process.exit(1);
});
