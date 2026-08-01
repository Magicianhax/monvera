"use client";

// The user's live position in a grove, read straight from the contract.
//
// Read against the SMART ACCOUNT, because GroveManager keys positions on
// msg.sender and every grove buy is a sponsored UserOp. Reading the EOA would
// always return an empty position and the exit UI would never appear.
import { useQuery } from "@tanstack/react-query";
import { parseAbi, type Address } from "viem";
import { publicClient } from "@/lib/wagmi";
import { GROVE_MANAGER } from "@/lib/groveManager";
import { useSmartAccountAddress } from "@/hooks/useSmartAccountAddress";

const POSITION_ABI = parseAbi([
  "function positionOf(address user, uint256 groveId) view returns (uint256 costBasisUsdg, address[] tokens, uint256[] amounts)",
]);

export interface GrovePositionLive {
  /** Cost basis in USD. Zero means no open position. */
  costBasisUsd: number;
  holdings: { token: Address; amount: bigint }[];
  /** True when there is something to exit. */
  open: boolean;
}

/** Live position for one grove, or undefined while loading / not applicable. */
export function useGrovePosition(onChainId?: number) {
  const smart = useSmartAccountAddress();

  return useQuery({
    queryKey: ["grove-position", GROVE_MANAGER, onChainId, smart],
    enabled: Boolean(GROVE_MANAGER && smart && onChainId !== undefined),
    refetchInterval: 30_000,
    queryFn: async (): Promise<GrovePositionLive> => {
      const [costBasisUsdg, tokens, amounts] = await publicClient.readContract({
        address: GROVE_MANAGER as Address,
        abi: POSITION_ABI,
        functionName: "positionOf",
        args: [smart as Address, BigInt(onChainId!)],
      });
      const holdings = tokens.map((token, i) => ({ token, amount: amounts[i] }));
      return {
        costBasisUsd: Number(costBasisUsdg) / 1e6,
        holdings,
        open: costBasisUsdg > BigInt(0) && holdings.some((h) => h.amount > BigInt(0)),
      };
    },
  });
}
