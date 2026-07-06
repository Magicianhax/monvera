"use client";

// The user's account = the Privy embedded EOA.
//
// Arcus's spot RFQ only builds a settlement tx for a PLAIN EOA taker (a smart
// account is never accepted), so the EOA is the address we show, fund, read
// balances for, and trade from. Gas stays sponsored: signed calls are relayed
// through a Pimlico smart account (see lib/aa.sendSponsoredCalls), and the USDG
// approval is gasless via EIP-2612 permit — so the user never needs native ETH.
import { useDemo } from "@/components/demo/DemoProvider";
import { useActiveWallet } from "@/hooks/useActiveWallet";

export function useSmartAccount() {
  const demo = useDemo();
  const wallet = useActiveWallet();
  if (demo) return { address: demo.address, loading: false, error: null };
  return {
    address: (wallet?.address as `0x${string}` | undefined) ?? null,
    loading: false,
    error: null,
  };
}
