import { signRecommendationV2, buildPlanId, recHash, commitRecord } from "../src/record";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Allocation } from "../src/allocation-schema";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const plan: Allocation = {
  summary: "s",
  rationale: "r",
  riskScore: 4000,
  allocations: [
    { symbol: "AAPLx", weightPct: 60, reason: "a" },
    { symbol: "MSFTx", weightPct: 40, reason: "b" },
  ],
};

test("V2 signature binds payer, usdSpent and legCount and recovers to the signer", async () => {
  const account = privateKeyToAccount(PK);
  const message = {
    planId: buildPlanId(plan, "nonce-1"),
    recHash: recHash(plan),
    assessedRisk: 4000,
    maxRisk: 5500,
    expiry: 2_000_000_000n,
    payer: "0x3333333333333333333333333333333333333333" as const,
    usdSpent: 500_000n,
    legCount: 2,
  };
  const { signature, domain, types } = await signRecommendationV2(
    PK,
    196,
    "0x4444444444444444444444444444444444444444",
    message
  );
  const recovered = await recoverTypedDataAddress({
    domain: domain as never,
    types,
    primaryType: "RecommendationV2",
    message,
    signature,
  });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

  // A tampered payer must NOT recover to the signer (the V1 gap, closed).
  const tampered = await recoverTypedDataAddress({
    domain: domain as never,
    types,
    primaryType: "RecommendationV2",
    message: { ...message, payer: "0x9999999999999999999999999999999999999999" },
    signature,
  });
  expect(tampered.toLowerCase()).not.toBe(account.address.toLowerCase());
});

test("planId is deterministic per nonce, distinct across nonces", () => {
  expect(buildPlanId(plan, "n1")).toBe(buildPlanId(plan, "n1"));
  expect(buildPlanId(plan, "n1")).not.toBe(buildPlanId(plan, "n2"));
});

test("commitRecord no-ops without a contract address", async () => {
  const ctx = { waitUntil: () => undefined } as never;
  const out = await commitRecord({} as never, ctx, plan, "0x0", 100);
  expect(out).toBeUndefined();
});

test("commitRecord queues a tx and returns the planId when configured", async () => {
  let queued = false;
  const ctx = { waitUntil: (p: Promise<unknown>) => { queued = true; p.catch(() => undefined); } } as never;
  const env = {
    VERA_RECORD_V2_ADDRESS: "0x4444444444444444444444444444444444444444",
    AGENT_SIGNER_PRIVATE_KEY: PK,
    RECORD_COMMITTER_PRIVATE_KEY: PK,
  } as never;
  globalThis.fetch = (async () => {
    throw new Error("no rpc in tests");
  }) as never;
  const out = await commitRecord(env, ctx, plan, "0x3333333333333333333333333333333333333333", 100);
  expect(out?.txQueued).toBe(true);
  expect(out?.planId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(queued).toBe(true);
});
