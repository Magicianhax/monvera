// Bridges Privy's EIP-1193 provider type to viem's. Both expose the same
// `request` surface (all aa.ts uses); only the optional `on`/`removeListener`
// event-handler generics differ between the two packages' type declarations.
// This cast is structurally safe for our usage.
import type { EIP1193Provider } from "viem";

export function asViemProvider(provider: unknown): EIP1193Provider {
  return provider as EIP1193Provider;
}
