"use client";

// Web3Providers — Privy auth + wagmi chain context, mounted ONLY where the
// product actually needs a wallet.
//
//   <PrivyProvider>        email + passkey login, gasless embedded wallet, default chain Robinhood Chain
//     <WagmiProvider>      chain context + read transports (see lib/wagmi.ts)
//       {children}
//
// This used to live in the root layout, which meant every marketing visitor
// downloaded and booted the whole auth stack (Privy + Coinbase + WalletConnect
// ≈ 2.7MB raw) just to read the landing page. It is now mounted by the two
// surfaces that need it — AppShell (/app) and DemoMount (/demo) — so static
// pages ship none of it. QueryClientProvider stays at the root (wagmi requires
// a QueryClient ancestor, and app hooks share that cache).
//
// Privy owns auth and the embedded wallet; wagmi is read-only here (no connector).
// Account-abstraction sends go through lib/aa.ts, which pulls the EIP-1193
// provider from the Privy embedded wallet.
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import type { ReactNode } from "react";
import { chain, wagmiConfig } from "@/lib/wagmi";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Web3Providers({ children }: { children: ReactNode }) {
  // Fail loudly in development if the app id is missing; render children bare
  // so the rest of the app can still mount (auth-gated UI simply won't unlock).
  if (!PRIVY_APP_ID) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set in .env.local");
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Email, Google, X (Twitter) — or bring your own EOA wallet.
        // (Passkey is omitted: it's currently disabled in the Privy dashboard. Re-add "passkey" once enabled there.)
        loginMethods: ["email", "google", "twitter", "wallet"],
        defaultChain: chain,
        supportedChains: [chain],
        // Social/email users get a no-seed-phrase embedded wallet; users who connect
        // their own wallet keep using that EOA (it owns their gasless smart account).
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          // Sign silently: a plan invest signs one Permit2 witness PER leg, so
          // the modal popped 10+ times for a single tap. The user already
          // reviews and approves the whole plan/trade before signing begins, so
          // per-signature confirmations only add friction. (External wallets
          // still show their own UI — this only affects Privy embedded wallets.)
          showWalletUIs: false,
        },
        // Branded to match the app: deep "Soft"-dark surface, sage-green accent,
        // the Monvera logo, email/social first (beginner-friendly), on-voice copy.
        appearance: {
          theme: "#15191a", // app dark paper
          accentColor: "#2f9d67", // Monvera green
          logo: "/icon-192.png",
          showWalletLoginFirst: false, // email + social first (beginner-friendly)
          landingHeader: "Welcome to Monvera",
          loginMessage: "Invest in real companies, in plain words.",
          walletChainType: "ethereum-only", // EVM chain; hide Solana wallets
          walletList: ["detected_wallets", "metamask", "coinbase_wallet", "wallet_connect", "rainbow"],
        },
      }}
    >
      <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
    </PrivyProvider>
  );
}
