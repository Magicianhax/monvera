// SERVER-ONLY. Signs Vera's risk inferences with the agent signer key so the
// on-chain VeraRecord contract (EIP-712) accepts and records the plan.
//
// IMPORTANT: never read the wall clock at module top-level. `expiry` and any
// nonce/timestamp are passed in as arguments by the request handler.
//
// The `server-only` import is a build-time guard: if this module is ever pulled
// into a client bundle (which would risk leaking AGENT_SIGNER_PRIVATE_KEY), the
// build fails loudly instead of silently shipping it.
import "server-only";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { INFERENCE_VERIFIER as VERA_RECORD_ADDRESS } from "./tokens";
import { CHAIN_ID } from "./chain";
import type { Allocation } from "./allocation-schema";

/** EIP-712 domain — MUST match the deployed VeraRecord contract exactly. */
export function inferenceDomain() {
  return {
    name: "VeraRecord",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: VERA_RECORD_ADDRESS,
  } as const;
}

export const RISK_INFERENCE_TYPES = {
  RiskInference: [
    { name: "planId", type: "bytes32" },
    { name: "assessedRisk", type: "uint16" },
    { name: "maxRisk", type: "uint16" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export interface RiskInferenceInput {
  planId: `0x${string}`;
  assessedRisk: number;
  maxRisk: number;
  expiry: bigint;
}

function agentAccount() {
  const pk = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!pk) throw new Error("AGENT_SIGNER_PRIVATE_KEY is not configured.");
  return privateKeyToAccount(pk as `0x${string}`);
}

/** The on-chain address that the verifier checks against (derived from the key). */
export function agentSignerAddress(): `0x${string}` {
  return agentAccount().address;
}

/**
 * Build a deterministic planId from the allocation and a caller-supplied nonce
 * (e.g. a request timestamp). The clock is NEVER read here — `nonce` is an argument.
 */
export function buildPlanId(allocation: Allocation, nonce: number | string): `0x${string}` {
  const payload = JSON.stringify({ allocation, nonce });
  return keccak256(toHex(payload));
}

/** keccak256 of the canonical allocation JSON — the recommendation commitment. */
export function recHash(allocation: Allocation): `0x${string}` {
  return keccak256(toHex(JSON.stringify(allocation)));
}

/** Sign a RiskInference; returns the 65-byte ECDSA signature as 0x-hex. */
export async function signRiskInference(input: RiskInferenceInput): Promise<`0x${string}`> {
  const account = agentAccount();
  return account.signTypedData({
    domain: inferenceDomain(),
    types: RISK_INFERENCE_TYPES,
    primaryType: "RiskInference",
    message: {
      planId: input.planId,
      assessedRisk: input.assessedRisk,
      maxRisk: input.maxRisk,
      expiry: input.expiry,
    },
  });
}
