import { signRecommendationV2, deterministicPlanId, recHash, commitRecord } from "../src/record";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Allocation } from "../src/allocation-schema";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PAYER = "0x3333333333333333333333333333333333333333" as const;

const plan: Allocation = {
  summary: "s",
  rationale: "r",
  riskScore: 4000,
  allocations: [
    { symbol: "AAPLx", weightPct: 60, reason: "a" },
    { symbol: "MSFTx", weightPct: 40, reason: "b" },
  ],
};

function kvStub(store: Map<string, string> = new Map()) {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

test("V2 signature binds payer, usdSpent and legCount and recovers to the signer", async () => {
  const account = privateKeyToAccount(PK);
  const hash = recHash(plan);
  const message = {
    planId: deterministicPlanId(PAYER, hash, 500_000n),
    recHash: hash,
    assessedRisk: 4000,
    maxRisk: 5500,
    expiry: 2_000_000_000n,
    payer: PAYER,
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

test("planId is deterministic and content+size addressed", () => {
  const hash = recHash(plan);
  expect(deterministicPlanId(PAYER, hash, 40_000_000n)).toBe(deterministicPlanId(PAYER, hash, 40_000_000n));
  // Different size => different planId (volume honesty)
  expect(deterministicPlanId(PAYER, hash, 40_000_000n)).not.toBe(deterministicPlanId(PAYER, hash, 100_000_000n));
  // Different payer => different planId
  expect(deterministicPlanId(PAYER, hash, 40_000_000n)).not.toBe(
    deterministicPlanId("0x1111111111111111111111111111111111111111", hash, 40_000_000n)
  );
});

test("commitRecord no-ops without a contract address", async () => {
  const ctx = { waitUntil: () => undefined } as never;
  const out = await commitRecord({ KV: kvStub() } as never, ctx, plan, "0x0", 100);
  expect(out).toBeUndefined();
});

test("commitRecord commits once, then dedupes identical content at identical size", async () => {
  const store = new Map<string, string>();
  let queued = 0;
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      queued++;
      p.catch(() => undefined);
    },
  } as never;
  const env = {
    KV: kvStub(store),
    VERA_RECORD_V2_ADDRESS: "0x4444444444444444444444444444444444444444",
    AGENT_SIGNER_PRIVATE_KEY: PK,
    RECORD_COMMITTER_PRIVATE_KEY: PK,
  } as never;
  globalThis.fetch = (async () => {
    throw new Error("no rpc in tests");
  }) as never;

  const first = await commitRecord(env, ctx, plan, PAYER, 100);
  expect(first?.status).toBe("committed");
  expect(first?.planId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(queued).toBe(1);

  // Simulate the rec: mirror having landed (the waitUntil write).
  store.set(`rec:${first!.planId}`, JSON.stringify({ committedAt: Date.now() }));

  const second = await commitRecord(env, ctx, plan, PAYER, 100);
  expect(second?.status).toBe("duplicate");
  expect(second?.planId).toBe(first?.planId);
  expect(queued).toBe(1); // no second tx queued

  // Same content at a DIFFERENT size records anew.
  const resized = await commitRecord(env, ctx, plan, PAYER, 250);
  expect(resized?.status).toBe("committed");
  expect(resized?.planId).not.toBe(first?.planId);
});
