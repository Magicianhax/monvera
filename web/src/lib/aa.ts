"use client";

// Gasless ERC-4337 account abstraction for Monvera.
//
// Flow: Privy gives us an embedded EOA (EIP-1193 provider) -> we make it the
// OWNER of a SimpleSmartAccount -> we send batched UserOperations through the
// Pimlico bundler, with gas sponsored by the Pimlico paymaster. The Pimlico API
// key never reaches the browser: both bundler and paymaster RPC go through our
// /api/pimlico proxy route.
//
// Public surface:
//   getSmartAccountClient(provider) -> SmartAccountClient (cached per owner)
//   sendSponsoredCalls(provider, calls) -> tx receipt (waits for inclusion)
//
// `provider` is obtained in components via Privy:
//   const { wallets } = useWallets();
//   const provider = await wallets[0].getEthereumProvider();
import { custom, type Address, type EIP1193Provider, type Hex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { chain, publicClient } from "./wagmi";
import { authHeader } from "./authedFetch";

/** A single contract call to batch into a UserOperation. */
export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
}

// Same-origin proxy that injects PIMLICO_API_KEY server-side (see api/pimlico/route.ts).
const BUNDLER_URL = "/api/pimlico";

const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;

// Gas price barely moves within the few seconds a multi-leg invest/sell takes,
// so cache pimlico_getUserOperationGasPrice for a short window instead of calling
// it once per leg's UserOp. One of several cuts to stay well under Pimlico limits.
type FeePrice = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
let gasPriceCache: { at: number; fast: FeePrice } | null = null;
async function cachedFastGas(pimlico: ReturnType<typeof createPimlicoClient>): Promise<FeePrice> {
  const now = Date.now();
  if (gasPriceCache && now - gasPriceCache.at < 8_000) return gasPriceCache.fast;
  const { fast } = await pimlico.getUserOperationGasPrice();
  gasPriceCache = { at: now, fast };
  return fast;
}

async function buildClient(provider: EIP1193Provider) {
  // Pimlico client serves BOTH paymaster sponsorship and user-op gas pricing,
  // through our same-origin proxy (transport target = /api/pimlico).
  const pimlico = createPimlicoClient({
    chain,
    transport: custom(rpcProvider(BUNDLER_URL)),
    entryPoint: ENTRY_POINT,
  });

  // The Privy embedded EOA (EIP-1193) is the OWNER/signer of the smart account.
  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: provider,
    entryPoint: ENTRY_POINT,
  });
  const owner = account.address;

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: custom(rpcProvider(BUNDLER_URL)),
    // `true` is not enough when the paymaster lives behind a proxy; wire the
    // sponsorship calls explicitly to the Pimlico client.
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => cachedFastGas(pimlico),
    },
  });

  return { owner: owner as Address, account, smartAccountClient };
}

// Build once per provider instance (and dedupe concurrent builds) so repeated
// invests reuse the same account + bundler wiring instead of re-deriving the
// smart account on every call.
const providerCache = new WeakMap<
  EIP1193Provider,
  Promise<Awaited<ReturnType<typeof buildClient>>>
>();

/** Get (or build + cache) the smart-account client for a Privy provider. */
export function getSmartAccountClient(provider: EIP1193Provider) {
  const existing = providerCache.get(provider);
  if (existing) return existing;
  const built = buildClient(provider);
  providerCache.set(provider, built);
  return built;
}

/**
 * Send a batched, gas-sponsored UserOperation and wait for it to be mined.
 * Example calls: [approve USDC -> executor, executor.investWithAI(...)].
 * Returns the user-operation receipt (includes the on-chain tx hash + status).
 */
export async function sendSponsoredCalls(provider: EIP1193Provider, calls: Call[]) {
  if (calls.length === 0) throw new Error("sendSponsoredCalls: no calls provided.");

  const { smartAccountClient, account } = await getSmartAccountClient(provider);

  const userOpHash = await smartAccountClient.sendUserOperation({
    account,
    calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? BigInt(0) })),
  });

  // Poll the bundler for the receipt less aggressively (default is ~1s) — fewer
  // eth_getUserOperationReceipt calls per leg, which adds up across a basket.
  const receipt = await smartAccountClient.waitForUserOperationReceipt({
    hash: userOpHash,
    pollingInterval: 2_500,
    timeout: 90_000,
  });
  if (!receipt.success) {
    throw new Error(`UserOperation reverted (txHash ${receipt.receipt.transactionHash}).`);
  }
  return receipt;
}

// --- internals -------------------------------------------------------------

// A minimal EIP-1193-shaped provider over an HTTP JSON-RPC endpoint, so we can
// reuse viem's `custom()` transport for the same-origin Pimlico proxy. Rate
// limits (Pimlico per-IP 429s, or our own proxy's) are retried with backoff
// instead of failing the leg — a multi-leg invest bursts enough calls to trip
// them transiently.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function rpcProvider(url: string): EIP1193Provider {
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      const MAX_TRIES = 4;
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, {
          method: "POST",
          // Carry the Privy session token so the /api/pimlico proxy can authorize
          // the caller (the proxy rejects anonymous/unknown-method requests).
          headers: { "content-type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }),
        });
        const json = await res.json().catch(() => ({}));
        const rateLimited =
          res.status === 429 ||
          json?.statusCode === 429 ||
          /rate limit|too many requests/i.test(
            typeof json?.error === "string" ? json.error : (json?.error?.message ?? json?.message ?? ""),
          );
        if (rateLimited && attempt < MAX_TRIES) {
          const retryAfter = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1_200 * attempt);
          continue;
        }
        if (json.error) {
          const e = json.error;
          const msg = typeof e === "string" ? e : e?.message;
          throw new Error(msg ? `${msg}` : "Bundler RPC error");
        }
        return json.result;
      }
    },
  } as unknown as EIP1193Provider;
}
