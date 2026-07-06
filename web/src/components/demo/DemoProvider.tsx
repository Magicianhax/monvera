"use client";

// DemoProvider — wraps the REAL Monvera app so its hooks return demo values instead
// of touching auth/chain/AI. The hooks (useSmartAccount, useBalances, useActivity,
// useInvest) each read this context and short-circuit when present; when absent
// (the entire production app) they behave exactly as before.
//
// `play` selects an auto-played script for the landing phones:
//   null     → fully interactive (hero phone, /demo)
//   "invest" → loops the goal → plan → invest → success flow
//   "vera"   → loops Vera's build-and-sign story
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Portfolio } from "@/hooks/useBalances";
import type { ActivityRow, VeraRecord } from "@/lib/onchainHistory";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";
import type { Allocation } from "@/lib/allocation-schema";
import {
  DEMO_ADDRESS,
  DEMO_USDC,
  DEMO_PORTFOLIO,
  DEMO_ACTIVITY,
  DEMO_VERA_RECORD,
  demoAllocate,
  demoSuccess,
} from "@/lib/demo/demoData";

export type DemoPlay = "invest" | "vera" | null;

export interface DemoApi {
  address: `0x${string}`;
  usdc: { raw: bigint; value: number };
  portfolio: Portfolio;
  activity: ActivityRow[];
  veraRecord: VeraRecord;
  allocate: (goal: string, amountUsd: number, risk?: string) => AllocateResult;
  success: (alloc: Allocation, amountUsd: number) => InvestSuccess;
  play: DemoPlay;
}

const DemoContext = createContext<DemoApi | null>(null);

/** Demo overrides when mounted under <DemoProvider>, else null (production). */
export function useDemo(): DemoApi | null {
  return useContext(DemoContext);
}

export function DemoProvider({ play = null, children }: { play?: DemoPlay; children: ReactNode }) {
  // Invariant: demo overrides are for the marketing landing + /demo ONLY. They
  // must NEVER wrap the real signed-in app (/app), or a real user could be routed
  // through mock (no-op) transactions that show fake success. Trip loudly in dev
  // if that ever happens so a misplaced provider is caught immediately.
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/app")
    ) {
      console.error("[DemoProvider] mounted on /app — the real app must never run under demo overrides.");
    }
  }, []);

  const value = useMemo<DemoApi>(
    () => ({
      address: DEMO_ADDRESS as `0x${string}`,
      usdc: DEMO_USDC,
      portfolio: DEMO_PORTFOLIO,
      activity: DEMO_ACTIVITY,
      veraRecord: DEMO_VERA_RECORD,
      allocate: demoAllocate,
      success: demoSuccess,
      play,
    }),
    [play],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
