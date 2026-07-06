// Minimal viem ABIs (as const) for the Monvera invest pipeline on Robinhood Chain (chainId 4663).
// Kept intentionally small — only the functions/events the app actually calls.

/**
 * StaxExecutor.investWithAI — the single entrypoint that pulls USDC, swaps each leg
 * through the leg.router, enforces minOut, and forwards the bought tokens to the caller.
 * Structs mirror the deployed contract exactly (see SPEC / task brief).
 */
export const STAX_EXECUTOR_ABI = [
  {
    type: "function",
    name: "investWithAI",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "plan",
        type: "tuple",
        components: [
          { name: "planId", type: "bytes32" },
          { name: "recHash", type: "bytes32" },
          { name: "riskScore", type: "uint16" },
          { name: "agentId", type: "uint256" },
        ],
      },
      {
        name: "inf",
        type: "tuple",
        components: [
          { name: "assessedRisk", type: "uint16" },
          { name: "maxRisk", type: "uint16" },
          { name: "expiry", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
      {
        name: "legs",
        type: "tuple[]",
        components: [
          { name: "router", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "usdcIn", type: "uint256" },
          { name: "minOut", type: "uint256" },
          { name: "swapData", type: "bytes" },
        ],
      },
      { name: "usdcTotal", type: "uint256" },
    ],
    outputs: [],
  },
  // ---- admin (owner = deployer) ----
  {
    type: "function",
    name: "setRouter",
    stateMutability: "nonpayable",
    inputs: [
      { name: "r", type: "address" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAssets",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokens", type: "address[]" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "routerAllowed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "assetAllowed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  // ---- events (mirror the deployed StaxExecutor exactly) ----
  {
    type: "event",
    name: "RecommendationCommitted",
    inputs: [
      { name: "planId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "recHash", type: "bytes32", indexed: false },
      { name: "riskScore", type: "uint16", indexed: false },
      { name: "agentId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LegFilled",
    inputs: [
      { name: "planId", type: "bytes32", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "usdcIn", type: "uint256", indexed: false },
      { name: "received", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllocationExecuted",
    inputs: [
      { name: "planId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "usdcSpent", type: "uint256", indexed: false },
      { name: "legCount", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * InferenceVerifier.verify — reverts unless ECDSA signer == agentSigner,
 * assessedRisk <= maxRisk, and block.timestamp <= expiry.
 */
export const INFERENCE_VERIFIER_ABI = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "planId", type: "bytes32" },
      { name: "assessedRisk", type: "uint16" },
      { name: "maxRisk", type: "uint16" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "agentSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** IdentityRegistry — reputation + metadata for the Monvera agent (agentId 1). */
export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "reputationScore",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Standard ERC20 surface the app reads/writes. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

// (The Mantle-era Fluxion/Agni router + V3 pool ABIs were removed — trading on
// Robinhood Chain goes through the Arcus spot RFQ router, not an on-chain AMM.)

/**
 * VeraRecord (Robinhood Chain) — verifies Vera's EIP-712 risk inference and
 * emits the permanent RecommendationCommitted/AllocationExecuted record, called
 * in the same batch as the Arcus settlements.
 */
export const VERA_RECORD_ABI = [
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
      { name: "signature", type: "bytes" },
      { name: "user", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "usdSpent", type: "uint256" },
      { name: "legCount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
