// VeraRecordV2 — sign each paid recommendation with the agent key and commit
// it on X Layer in the background (ctx.waitUntil; never blocks the response).
// No-ops (returns undefined) when VERA_RECORD_V2_ADDRESS is unset, so the
// worker runs before the contract is deployed.
import {
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  defineChain,
  type Hex,
} from "viem";
import { Attribution } from "ox/erc8021";
import { privateKeyToAccount } from "viem/accounts";
import type { Allocation } from "./allocation-schema";
import type { Env } from "./env";

export const XLAYER_CHAIN_ID = 196;
const XLAYER_RPC = "https://rpc.xlayer.tech";

export const xlayerChain = defineChain({
  id: XLAYER_CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC] } },
});

export const VERA_RECORD_V2_ABI = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "planId", type: "bytes32" },
      { name: "recHash", type: "bytes32" },
      { name: "assessedRisk", type: "uint16" },
      { name: "maxRisk", type: "uint16" },
      { name: "expiry", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "usdSpent", type: "uint256" },
      { name: "legCount", type: "uint16" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const RECOMMENDATION_V2_TYPES = {
  RecommendationV2: [
    { name: "planId", type: "bytes32" },
    { name: "recHash", type: "bytes32" },
    { name: "assessedRisk", type: "uint16" },
    { name: "maxRisk", type: "uint16" },
    { name: "expiry", type: "uint256" },
    { name: "payer", type: "address" },
    { name: "usdSpent", type: "uint256" },
    { name: "legCount", type: "uint16" },
  ],
} as const;

export interface RecommendationV2Message {
  planId: Hex;
  recHash: Hex;
  assessedRisk: number;
  maxRisk: number;
  expiry: bigint;
  payer: Hex;
  usdSpent: bigint;
  legCount: number;
}

/** Deterministic plan id: keccak of the allocation + a nonce. */
export function buildPlanId(allocation: { allocations: unknown[] }, nonce: string): Hex {
  return keccak256(toBytes(JSON.stringify({ allocation, nonce })));
}

/** Content hash binding the full recommendation text/weights. */
export function recHash(allocation: Allocation): Hex {
  return keccak256(toBytes(JSON.stringify(allocation)));
}

export async function signRecommendationV2(
  privateKey: Hex,
  chainId: number,
  verifyingContract: Hex,
  message: RecommendationV2Message
): Promise<{ signature: Hex; domain: Record<string, unknown>; types: typeof RECOMMENDATION_V2_TYPES }> {
  const account = privateKeyToAccount(privateKey);
  const domain = { name: "VeraRecordV2", version: "1", chainId, verifyingContract } as const;
  const signature = await account.signTypedData({
    domain,
    types: RECOMMENDATION_V2_TYPES,
    primaryType: "RecommendationV2",
    message,
  });
  return { signature, domain, types: RECOMMENDATION_V2_TYPES };
}

export interface RecordReceipt {
  planId: string;
  txQueued: boolean;
}

function clampRisk(riskScore: number): number {
  return Math.max(0, Math.min(10000, Math.round(riskScore)));
}

export async function commitRecord(
  env: Env,
  ctx: ExecutionContext,
  plan: Allocation,
  payer: string,
  usdSpent: number
): Promise<RecordReceipt | undefined> {
  const contract = env.VERA_RECORD_V2_ADDRESS as Hex | undefined;
  if (!contract || !env.AGENT_SIGNER_PRIVATE_KEY || !env.RECORD_COMMITTER_PRIVATE_KEY) {
    return undefined;
  }

  const assessedRisk = clampRisk(plan.riskScore);
  const maxRisk = Math.min(assessedRisk + 1500, 10000);
  const message: RecommendationV2Message = {
    planId: buildPlanId(plan, crypto.randomUUID()),
    recHash: recHash(plan),
    assessedRisk,
    maxRisk,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 900),
    payer: (payer.startsWith("0x") && payer.length === 42 ? payer : "0x0000000000000000000000000000000000000000") as Hex,
    usdSpent: BigInt(Math.round(usdSpent * 1_000_000)), // 6dp USD units
    legCount: plan.allocations.length,
  };

  const { signature } = await signRecommendationV2(
    env.AGENT_SIGNER_PRIVATE_KEY as Hex,
    XLAYER_CHAIN_ID,
    contract,
    message
  );

  const committer = privateKeyToAccount(env.RECORD_COMMITTER_PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account: committer, chain: xlayerChain, transport: http() });

  // ERC-8021 builder-code suffix (X Layer attribution) — the EVM ignores
  // trailing calldata, so record() executes identically with or without it.
  let data = encodeFunctionData({
    abi: VERA_RECORD_V2_ABI,
    functionName: "record",
    args: [
      message.planId,
      message.recHash,
      message.assessedRisk,
      message.maxRisk,
      message.expiry,
      message.payer,
      message.usdSpent,
      message.legCount,
      signature,
    ],
  });
  if (env.BUILDER_CODE) {
    data = (data + Attribution.toDataSuffix({ codes: [env.BUILDER_CODE] }).slice(2)) as Hex;
  }

  ctx.waitUntil(
    wallet
      .sendTransaction({ to: contract, data })
      .then((hash) => console.log("record committed", message.planId, hash))
      .catch((err) => console.error("record commit failed", message.planId, err))
  );

  return { planId: message.planId, txQueued: true };
}
