"use client";

// Root client providers — deliberately LIGHT, because this wraps every page
// including the static marketing site.
//
//   <QueryClientProvider>  react-query cache (shared by wagmi + app hooks)
//     <ServiceWorkerRegistrar />  PWA/offline
//     <ColorStyleTag />           brand color variables
//     {children}
//
// The wallet stack (Privy + wagmi) is NOT here: it lives in
// components/Web3Providers.tsx and is mounted only by AppShell (/app) and
// DemoMount (/demo). Keeping it out of the root layout is what stops a landing
// page visitor from downloading the whole auth SDK. Do not re-add it here.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { ColorStyleTag } from "@/components/ColorStyleTag";

export function Providers({ children }: { children: ReactNode }) {
  // Reaching here means the page mounted, so app/error.tsx's one-shot
  // stale-chunk reload guard can be cleared — a chunk that goes stale later in
  // the same session (another deploy) is then free to auto-recover too.
  useEffect(() => {
    try {
      sessionStorage.removeItem("mv.chunkReload");
    } catch {
      /* storage blocked — the guard simply stays one-shot */
    }
  }, []);

  // One QueryClient per browser session (stable across re-renders, never on the server).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ServiceWorkerRegistrar />
      <ColorStyleTag />
      {children}
    </QueryClientProvider>
  );
}
