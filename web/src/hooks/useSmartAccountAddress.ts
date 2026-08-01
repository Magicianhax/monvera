"use client";

// The user's ERC-4337 smart account address, as React state.
//
// Not the same thing as `useSmartAccount()`, which despite its name returns the
// Privy EOA (the app settled on the EOA as taker because Arcus's RFQ only built
// settlements for a plain EOA). This is the counterparty address: the account
// that actually executes sponsored UserOps.
//
// It matters because GroveManager keys positions on `msg.sender`, so a Grove
// basket is delivered to and owned by the SMART ACCOUNT, while ordinary trades
// deliver to the EOA. Any view of "what the user owns" has to look at both.
//
// Deriving it needs an async provider call, so it cannot be computed during
// render — react-query caches it per EOA. It is deterministic (CREATE2 from the
// owner), so it never goes stale and never needs refetching.
//
// EMBEDDED WALLET ONLY, and that restriction is load-bearing. This hook runs on
// page load wherever a portfolio is shown, unlike the trade hooks which only
// touch the provider when the user acts. `useActiveWallet` falls back to
// `wallets[0]` when the embedded wallet has not appeared yet, and during that
// window `wallets[0]` can be an installed extension — so calling
// getEthereumProvider() here would pop a Phantom/MetaMask connect prompt on
// every page load, and if the user accepted it we would derive a smart account
// owned by the WRONG wallet and read someone else's balances into their
// portfolio. Skipping instead is harmless: `&smart=` is simply omitted and the
// portfolio reads exactly as it did before, EOA-only.
import { useQuery } from "@tanstack/react-query";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { asViemProvider } from "@/lib/provider";
import { getSmartAccountClient } from "@/lib/aa";

/** The smart account address, or undefined until the embedded wallet is ready. */
export function useSmartAccountAddress(): `0x${string}` | undefined {
  const wallet = useActiveWallet();
  const embedded = wallet?.walletClientType === "privy" ? wallet : undefined;
  const eoa = embedded?.address;

  const { data } = useQuery({
    queryKey: ["smart-account-address", eoa],
    enabled: Boolean(eoa && embedded),
    // Counterfactual and deterministic — derived once, good for the session.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const provider = await embedded!.getEthereumProvider();
      const { owner } = await getSmartAccountClient(asViemProvider(provider));
      return owner;
    },
  });

  return data;
}
