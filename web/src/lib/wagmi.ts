// Robinhood Chain wiring for wagmi + viem. The chain object itself is defined in
// ./chain (single source of truth); this file wires it into a wagmi config and a
// shared read-only viem public client used by hooks/components for on-chain reads.
import { createConfig, http } from "wagmi";
import { createPublicClient } from "viem";
import { chain, RPC_URL } from "./chain";

export { chain };

/**
 * wagmi config. The embedded wallet + signing is owned by Privy (via its
 * EIP-1193 provider, consumed in lib/aa.ts), so wagmi here is configured purely
 * for chain context + HTTP transports used by read hooks. No connector is
 * registered: account abstraction sends transactions through the Pimlico
 * smart-account client, not wagmi.
 */
export const wagmiConfig = createConfig({
  chains: [chain],
  transports: {
    [chain.id]: http(RPC_URL),
  },
  ssr: true,
});

/**
 * Shared read-only client for balances, allowances, pool quotes, receipts.
 * `batch.multicall` aggregates every readContract issued in the same tick into
 * ONE Multicall3 eth_call (Multicall3 is verified deployed on Robinhood Chain),
 * cutting a portfolio refresh from ~15 RPCs to a single request.
 */
export const publicClient = createPublicClient({
  chain,
  batch: { multicall: { wait: 16 } },
  transport: http(RPC_URL),
});

export type WagmiConfig = typeof wagmiConfig;
