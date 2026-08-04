"use client";

// Auto-manage consent for one grove: read the smart account's on-chain
// AutoConfig, switch it on with the four hard caps, switch it off instantly.
//
// Chat never signs any of this — the switch lives on the grove page, the
// smart account signs one sponsored UserOp each way, and the CONTRACT
// enforces every cap against the manager (see GroveManager.AutoConfig).
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPublicClient, http, type Address } from "viem";
import { chain, RPC_URL } from "@/lib/chain";
import { assetBySymbol } from "@/lib/tokens";
import { explainError } from "@/lib/explainError";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useSmartAccountAddress } from "@/hooks/useSmartAccountAddress";
import { asViemProvider } from "@/lib/provider";
import { getSmartAccountClient, sendSponsoredCalls } from "@/lib/aa";
import {
  GROVE_MANAGER,
  GROVE_MANAGER_ABI,
  buildEnableAutoCalls,
  buildRevokeAutoCalls,
  type AutoCaps,
} from "@/lib/groveManager";

const client = createPublicClient({ chain, transport: http(RPC_URL) });

export interface GroveAutoState {
  enabled: boolean;
  /** USD (not raw): what one action may move / the lifetime budget / spent. */
  maxPerActionUsd: number;
  maxTotalUsd: number;
  movedUsd: number;
  /** Cooldown between manager actions, seconds. */
  cooldownSeconds: number;
  /** Unix seconds of the last manager action (0 = never). */
  lastActionAt: number;
  maxRebalanceFractionBps: number;
}

export function useGroveAutoState(onChainId: number | undefined) {
  const smart = useSmartAccountAddress();
  return useQuery({
    queryKey: ["grove-auto", onChainId, smart],
    enabled: !!GROVE_MANAGER && onChainId !== undefined && !!smart,
    staleTime: 30_000,
    queryFn: async (): Promise<GroveAutoState> => {
      const [enabled, maxPerBuy, maxTotal, moved, cooldown, lastAction, fractionBps] =
        await client.readContract({
          address: GROVE_MANAGER as Address,
          abi: GROVE_MANAGER_ABI,
          functionName: "autoConfigs",
          args: [smart as Address, BigInt(onChainId!)],
        });
      return {
        enabled,
        maxPerActionUsd: Number(maxPerBuy) / 1e6,
        maxTotalUsd: Number(maxTotal) / 1e6,
        movedUsd: Number(moved) / 1e6,
        cooldownSeconds: Number(cooldown),
        lastActionAt: Number(lastAction),
        maxRebalanceFractionBps: Number(fractionBps),
      };
    },
  });
}

export type GroveAutoPhase = "idle" | "signing" | "working" | "done" | "error";

export function useGroveAuto(onChainId: number | undefined, componentSymbols: string[]) {
  const wallet = useActiveWallet();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<GroveAutoPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const tokens = useMemo(
    () =>
      componentSymbols
        .map((s) => assetBySymbol(s)?.address as Address | undefined)
        .filter((a): a is Address => !!a),
    [componentSymbols],
  );

  const run = useCallback(
    async (build: () => ReturnType<typeof buildEnableAutoCalls>) => {
      setError(null);
      setTxHash(null);
      try {
        if (!GROVE_MANAGER || onChainId === undefined) throw new Error("This grove is not open yet.");
        if (!wallet?.address) throw new Error("Connect your wallet first.");
        setPhase("signing");
        const provider = await wallet.getEthereumProvider();
        const viemProvider = asViemProvider(provider);
        await getSmartAccountClient(viemProvider); // resolves + warms the account
        setPhase("working");
        const receipt = await sendSponsoredCalls(viemProvider, build());
        if (!receipt.success) {
          console.error("[grove-auto] reverted on-chain", receipt.receipt.transactionHash);
          throw new Error("That didn't go through on-chain, so nothing changed. Try again.");
        }
        setTxHash(receipt.receipt.transactionHash as `0x${string}`);
        setPhase("done");
        void qc.invalidateQueries({ queryKey: ["grove-auto"] });
      } catch (err) {
        setError(explainError(err));
        setPhase("error");
      }
    },
    [wallet, onChainId, qc],
  );

  const enable = useCallback(
    (caps: AutoCaps) => run(() => buildEnableAutoCalls(onChainId!, caps, tokens)),
    [run, onChainId, tokens],
  );

  const revoke = useCallback(() => run(() => buildRevokeAutoCalls(onChainId!, tokens)), [run, onChainId, tokens]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxHash(null);
  }, []);

  const busy = phase === "signing" || phase === "working";
  return useMemo(
    () => ({ phase, busy, error, txHash, enable, revoke, reset }),
    [phase, busy, error, txHash, enable, revoke, reset],
  );
}
