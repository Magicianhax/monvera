"use client";

// Staking works from two very different places:
//
//   1. Inside the app — the wallet the user already signed in with.
//   2. On the public /stake page — the same Privy flow: email/Google/X mints an
//      embedded wallet, or the user connects an EOA they already own.
//
// Either way useActiveWallet resolves to ONE signing address (embedded first,
// otherwise the connected EOA), so the UI and hook never care which it is, and
// no extra account is ever created just to stake.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { chain as appChain } from "@/lib/chain";
import { stakingChain } from "@/lib/staking";

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface StakingWallet {
  address: `0x${string}` | null;
  /** Shown in the confirm dialog so the user knows what will sign. */
  label: string;
  /** True when this wallet signs without showing its own confirmation UI. */
  silentSigning: boolean;
  /** Put the wallet on the staking chain (throws if it won't get there). */
  ensureChain: () => Promise<Eip1193>;
  /** Best-effort return to the app chain — no-op for the public page. */
  restoreChain: () => Promise<void>;
}

/** Poll until the provider itself reports the staking chain. The switch call
 *  resolves before the provider flips, and sending early makes viem refuse the
 *  transaction on a chain mismatch. */
async function waitForChain(get: () => Promise<Eip1193>): Promise<Eip1193> {
  for (let i = 0; i < 24; i++) {
    const provider = await get();
    const idHex = (await provider.request({ method: "eth_chainId" })) as string;
    if (parseInt(idHex, 16) === stakingChain.id) return provider;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Your wallet didn't switch to the staking network. Switch it manually and try again.");
}

// ── Privy: embedded wallet (email/social) OR a user's own EOA connected
//    through Privy's modal. useActiveWallet prefers the embedded wallet and
//    falls back to the connected one, which is exactly right for both the app
//    and the public page.

export interface PrivyStakingWallet extends StakingWallet {
  login: () => void;
  /** Fully drops the session: connection first, then Privy auth. */
  disconnect: () => Promise<void>;
  ready: boolean;
  authenticated: boolean;
  /** True for a Monvera-made embedded wallet (vs. a user's own EOA). */
  embedded: boolean;
}

/** @param walletUIs true when the surrounding Web3Providers enables Privy's own
 *  confirmation modal (the public /stake page does; the app does not). Only
 *  affects what the confirm dialog promises will happen next. */
export function usePrivyStakingWallet(opts?: { walletUIs?: boolean }): PrivyStakingWallet {
  const wallet = useActiveWallet();
  const { login, logout, ready, authenticated } = usePrivy();
  // switchChain re-renders with a NEW wallet object; an async flow holding the
  // old one would poll a provider pinned to the app chain forever.
  const ref = useRef(wallet);
  ref.current = wallet;

  const ensureChain = useCallback(async () => {
    const w = ref.current;
    if (!w) throw new Error("No wallet connected.");
    await w.switchChain(stakingChain.id);
    return waitForChain(async () => {
      const cur = ref.current ?? w;
      return (await cur.getEthereumProvider()) as unknown as Eip1193;
    });
  }, []);

  const restoreChain = useCallback(async () => {
    try { await (ref.current ?? wallet)?.switchChain(appChain.id); } catch { /* next flow re-switches */ }
  }, [wallet]);

  // An embedded Privy wallet signs silently; a user's own EOA connected via
  // Privy still shows that wallet's confirmation — say the right thing.
  const embedded = wallet?.walletClientType === "privy";

  // Order matters. logout() only ends the Privy SESSION; an external EOA stays
  // connected, so Privy re-surfaces it a tick later and the user sees
  // "disconnect" reconnect them. Drop the connection first, then the session.
  const disconnect = useCallback(async () => {
    try { ref.current?.disconnect(); } catch { /* client may not support it; state is cleared anyway */ }
    if (authenticated) {
      try { await logout(); } catch { /* already gone */ }
    }
  }, [authenticated, logout]);

  return {
    address: (wallet?.address as `0x${string}` | undefined) ?? null,
    label: embedded ? "your Monvera wallet" : (wallet?.walletClientType ?? "your wallet"),
    silentSigning: embedded && !opts?.walletUIs,
    ensureChain,
    restoreChain,
    login,
    disconnect,
    ready,
    authenticated,
    embedded,
  };
}
