// VeraRecordV2 — sign each paid recommendation with the agent key and commit
// it on X Layer in the background (ctx.waitUntil; never blocks the response).
//
// planId is DETERMINISTIC: keccak256(payer(20) ‖ recHash(32) ‖ usdSpent as a
// 32-byte big-endian uint of 6dp units). Identical content re-bought at the
// same size dedupes (VeraRecordV2 counts recommendations, not purchases);
// the same content at a DIFFERENT size records anew, keeping Vera's public
// volume honest. Concurrency note: with a deterministic planId the contract
// itself serializes duplicates — a same-instant double commit costs at worst
// one reverted tx; the record can never double-count.
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  concat,
  pad,
  toHex,
  defineChain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Attribution } from "ox/erc8021";
import type { Allocation } from "./allocation-schema";
import type { Env } from "./env";
import { BASE_URL } from "./respond";

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
  {
    type: "function",
    name: "used",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ type: "bool" }],
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;

/** Content hash binding the full recommendation exactly as delivered. */
export function recHash(allocation: Allocation): Hex {
  return keccak256(toBytes(JSON.stringify(allocation)));
}

/** Deterministic plan id: payer ‖ recHash ‖ usdSpent (6dp units, uint256 BE). */
export function deterministicPlanId(payer: Hex, hash: Hex, usdSpentUnits: bigint): Hex {
  return keccak256(concat([payer, hash, pad(toHex(usdSpentUnits), { size: 32 })]));
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
  status: "committed" | "duplicate" | "not-recorded" | "failed";
  planId?: string;
  recHash?: string;
  contract?: string;
  verify?: string;
  recompute?: string;
  boundary?: string;
  duplicateOf?: string;
  note?: string;
  why?: string;
}

const BOUNDARY =
  "A commitment proves Vera signed this recommendation for this payer at this spend before delivering it. It does not prove the buyer executed, that fills matched, or that the plan performed. Track record = recommendations, not results.";

const RECOMPUTE =
  "recHash = keccak256(utf8(JSON.stringify(response.plan))) — the plan object exactly as received. planId = keccak256(payer(20 bytes) ‖ recHash(32 bytes) ‖ usdSpent as 32-byte big-endian uint of usd*1e6).";

export function notRecorded(why: string): RecordReceipt {
  return { status: "not-recorded", why, boundary: BOUNDARY };
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

  const payerAddr = (payer.startsWith("0x") && payer.length === 42 ? payer : ZERO_ADDRESS) as Hex;
  const usdSpentUnits = BigInt(Math.round(usdSpent * 1_000_000));
  const hash = recHash(plan);
  const planId = deterministicPlanId(payerAddr, hash, usdSpentUnits);

  const base = {
    planId,
    recHash: hash,
    contract,
    verify: `${BASE_URL}/v1/record/${planId}`,
    recompute: RECOMPUTE,
    boundary: BOUNDARY,
  };

  // Fast dedupe: our own KV mirror of the contract's used(planId) mapping.
  const seen = await env.KV.get(`rec:${planId}`).catch(() => null);
  if (seen) {
    return {
      status: "duplicate",
      ...base,
      duplicateOf: planId,
      note: "Identical content at identical size was already committed. VeraRecordV2 counts recommendations, not purchases.",
    };
  }

  const assessedRisk = clampRisk(plan.riskScore);
  const maxRisk = Math.min(assessedRisk + 1500, 10000);
  const message: RecommendationV2Message = {
    planId,
    recHash: hash,
    assessedRisk,
    maxRisk,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 900),
    payer: payerAddr,
    usdSpent: usdSpentUnits,
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
  const reader = createPublicClient({ chain: xlayerChain, transport: http() });

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
    (async () => {
      try {
        // On-chain backstop: another isolate/purchase may have committed first.
        const used = await reader
          .readContract({ address: contract, abi: VERA_RECORD_V2_ABI, functionName: "used", args: [planId] })
          .catch(() => false);
        if (!used) {
          const txHash = await wallet.sendTransaction({ to: contract, data });
          console.log("record committed", planId, txHash);
          await env.KV.put(`rec:${planId}`, JSON.stringify({ txHash, committedAt: Date.now() }));
        } else {
          await env.KV.put(`rec:${planId}`, JSON.stringify({ committedAt: Date.now() }));
        }
      } catch (err) {
        console.error("record commit failed", planId, err);
      }
    })()
  );

  return { status: "committed", ...base };
}
