"use client";

// Client-side provider stack for Monvera.
//
//   <PrivyProvider>        email + passkey login, gasless embedded wallet, default chain Robinhood Chain
//     <QueryClientProvider> react-query cache (shared by wagmi + app hooks)
//       <WagmiProvider>    chain context + read transports (see lib/wagmi.ts)
//         {children}
//
// Privy owns auth and the embedded wallet; wagmi is read-only here (no connector).
// Account-abstraction sends go through lib/aa.ts, which pulls the EIP-1193
// provider from the Privy embedded wallet.
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { chain, wagmiConfig } from "@/lib/wagmi";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { ColorStyleTag } from "@/components/ColorStyleTag";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser session (stable across re-renders, never on the server).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

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
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <ServiceWorkerRegistrar />
          <ColorStyleTag />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
