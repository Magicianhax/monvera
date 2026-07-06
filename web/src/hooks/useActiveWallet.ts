"use client";

// useActiveWallet — the wallet that owns the user's smart account.
//
// Privy's useWallets() lists EVERY wallet it can see, including an installed
// browser extension (Phantom / MetaMask) that the user never chose. If we just
// grab wallets[0], an extension can end up as the smart-account owner — deriving
// the wrong account AND popping that extension to sign (the Phantom-popup bug).
//
// Fix: always prefer the Privy EMBEDDED wallet (email/social login,
// walletClientType "privy"). Only fall back to the first wallet for
// bring-your-own-wallet users, who have no embedded wallet at all.
import { useWallets, type ConnectedWallet } from "@privy-io/react-auth";

export function useActiveWallet(): ConnectedWallet | undefined {
  const { wallets } = useWallets();
  return wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
}
