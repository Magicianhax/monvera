"use client";

// Gasless token approval via EIP-2612 permit.
//
// Arcus pulls the taker's SELL token through Permit2, which first needs a
// one-time sellToken -> Permit2 allowance. Instead of an on-chain approve (which
// would need native ETH), the EOA signs a `permit` off-chain and a relayer
// submits it — so the user never needs gas. This works for the buy leg (USDG is
// pulled) AND the sell leg (the stock token is pulled). The EIP-712 domain is
// the token's own name() + version "1" (verified on-chain against each token's
// DOMAIN_SEPARATOR: USDG = "Global Dollar", stocks = e.g. "Apple • Robinhood Token").
import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { chain, RPC_URL } from "@/lib/chain";
import { USDG } from "@/lib/tokens";
import type { Call } from "@/lib/aa";

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const client = createPublicClient({ chain, transport: http(RPC_URL) });

const NONCES_ABI = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const PERMIT_ABI = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/**
 * Build a gasless EIP-2612 `permit` call for `token`, authorizing `spender`
 * (Permit2) to pull `value` (unlimited by default). The owner signs off-chain
 * via `signTypedData`; the returned Call is submitted by the gas-sponsored
 * relayer. The domain name is read from the token's own name() (version "1"),
 * so this works for USDG (buys) and any Robinhood stock token (sells) alike.
 * Pass an exact `value` when each spend should require a fresh signature
 * (e.g. the $MONVERA buy flow prompts the user per purchase).
 */
export async function buildPermitCall(
  signTypedData: (typedDataJson: string) => Promise<Hex>,
  owner: Address,
  spender: Address,
  token: Address,
  value: bigint = MAX_UINT256,
): Promise<Call> {
  const [nonce, name] = await Promise.all([
    client.readContract({ address: token, abi: NONCES_ABI, functionName: "nonces", args: [owner] }) as Promise<bigint>,
    client.readContract({ address: token, abi: NONCES_ABI, functionName: "name", args: [] }) as Promise<string>,
  ]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const typedData = JSON.stringify({
    domain: { name, version: "1", chainId: chain.id, verifyingContract: token },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner, spender, value: value.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
  });

  const sig = await signTypedData(typedData);
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = parseInt(sig.slice(130, 132), 16);

  return {
    to: token,
    data: encodeFunctionData({ abi: PERMIT_ABI, functionName: "permit", args: [owner, spender, value, deadline, v, r, s] }),
  };
}

/** Back-compat: permit the USDG token (the buy path). */
export function buildUsdgPermitCall(
  signTypedData: (typedDataJson: string) => Promise<Hex>,
  owner: Address,
  spender: Address,
): Promise<Call> {
  return buildPermitCall(signTypedData, owner, spender, USDG.address as Address);
}
