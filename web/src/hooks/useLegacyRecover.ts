"use client";

// One-time recovery of USDG stranded in the old smart-account address.
//
// The app used to treat a Pimlico smart account (derived from the Privy EOA) as
// the user's account; funds sent then landed there. The account is now the EOA
// itself (Arcus needs a plain EOA taker), so this sweeps any USDG left in the old
// smart account back to the EOA. The EOA owns that smart account, so the move is
// a normal sponsored UserOp — gas-free, no extra keys.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { chain, RPC_URL } from "@/lib/chain";
import { USDG } from "@/lib/tokens";
import { sendSponsoredCalls } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useRefreshBalances } from "@/hooks/useBalances";
import { useSmartAccountResolution } from "@/hooks/useSmartAccountAddress";

const client = createPublicClient({ chain, transport: http(RPC_URL) });
const BALANCE_OF = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const TRANSFER = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

type Phase = "checking" | "idle" | "moving" | "done" | "error";

export function useLegacyRecover() {
  const wallet = useActiveWallet();
  const refreshBalances = useRefreshBalances();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  // The smart-account address, without a provider round trip per mount.
  const { address: smartAddr } = useSmartAccountResolution();

  // LIVE balance, not a one-shot mount read: a grove exit deposits USDG here
  // mid-session, and the old effect never looked again — the "move to cash"
  // bar only appeared after a full page refresh. Keyed under "portfolio" so
  // useRefreshBalances' prefix invalidation refetches this the moment any
  // trade settles.
  const balQ = useQuery({
    queryKey: ["portfolio", "grove-cash", smartAddr],
    enabled: Boolean(smartAddr),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await client.readContract({
        address: USDG.address as `0x${string}`,
        abi: BALANCE_OF,
        functionName: "balanceOf",
        args: [smartAddr as `0x${string}`],
      })) as bigint,
  });
  const raw = balQ.data ?? BigInt(0);

  const recover = useCallback(async () => {
    if (!wallet || raw <= BigInt(0)) return;
    try {
      setPhase("moving");
      setError(null);
      const provider = asViemProvider(await wallet.getEthereumProvider());
      const eoa = wallet.address as `0x${string}`;
      const receipt = await sendSponsoredCalls(provider, [
        {
          to: USDG.address as `0x${string}`,
          data: encodeFunctionData({ abi: TRANSFER, functionName: "transfer", args: [eoa, raw] }),
        },
      ]);
      setTxHash(receipt.receipt.transactionHash as `0x${string}`);
      // Optimistically zero the bar, then let the refetch confirm — the cash
      // just changed pockets and every money surface should say so now.
      qc.setQueryData(["portfolio", "grove-cash", smartAddr], BigInt(0));
      setPhase("done");
      refreshBalances();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The move didn't go through.");
      setPhase("error");
    }
  }, [wallet, raw, refreshBalances, qc, smartAddr]);

  return {
    legacyAddr: smartAddr ?? null,
    usdValue: Number(raw) / 1_000_000, // USDG is 6dp
    hasFunds: raw > BigInt(0),
    phase: balQ.isPending && !smartAddr ? "idle" : balQ.isPending ? "checking" : phase,
    error,
    txHash,
    recover,
  };
}
