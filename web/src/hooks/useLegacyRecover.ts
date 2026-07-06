"use client";

// One-time recovery of USDG stranded in the old smart-account address.
//
// The app used to treat a Pimlico smart account (derived from the Privy EOA) as
// the user's account; funds sent then landed there. The account is now the EOA
// itself (Arcus needs a plain EOA taker), so this sweeps any USDG left in the old
// smart account back to the EOA. The EOA owns that smart account, so the move is
// a normal sponsored UserOp — gas-free, no extra keys.
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { chain, RPC_URL } from "@/lib/chain";
import { USDG } from "@/lib/tokens";
import { getSmartAccountClient, sendSponsoredCalls } from "@/lib/aa";
import { asViemProvider } from "@/lib/provider";
import { useActiveWallet } from "@/hooks/useActiveWallet";

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
  const [legacyAddr, setLegacyAddr] = useState<`0x${string}` | null>(null);
  const [raw, setRaw] = useState<bigint>(BigInt(0));
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const owner = wallet?.address;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wallet) {
        if (!cancelled) setPhase("idle");
        return;
      }
      try {
        if (!cancelled) setPhase("checking");
        const provider = asViemProvider(await wallet.getEthereumProvider());
        const { account } = await getSmartAccountClient(provider);
        const s = account.address as `0x${string}`;
        const bal = (await client.readContract({
          address: USDG.address as `0x${string}`,
          abi: BALANCE_OF,
          functionName: "balanceOf",
          args: [s],
        })) as bigint;
        if (!cancelled) {
          setLegacyAddr(s);
          setRaw(bal);
          setPhase("idle");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't check your previous account.");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner]);

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
      setRaw(BigInt(0));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The move didn't go through.");
      setPhase("error");
    }
  }, [wallet, raw]);

  return {
    legacyAddr,
    usdValue: Number(raw) / 1_000_000, // USDG is 6dp
    hasFunds: raw > BigInt(0),
    phase,
    error,
    txHash,
    recover,
  };
}
