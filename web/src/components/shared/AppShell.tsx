"use client";

// Top-level signed-in/out router.
//
// Signed out: the chat-design AuthScreen (aurora + glass) owns the viewport.
// Signed in: the chat-first shells (ChatApp / ChatAppMobile) own all chrome.
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AuthScreen } from "@/components/chat/AuthScreen";
import { ChatApp } from "@/components/chat/ChatApp";
import { ChatAppMobile } from "@/components/chat/ChatAppMobile";
import { ToastProvider } from "@/components/design/Toast";
import { Web3Providers } from "@/components/Web3Providers";

// The chat-first design ships as a responsive split at 761px (the "Monvera Chat"
// / "Monvera Chat Mobile" sub-designs). Both variants own all of their own
// chrome + theme; the classic LiteApp is fully retired from the signed-in path.
// Returns true on desktop widths, false on phones (SSR-safe: starts false).
function useChatDesktop(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    // Dev/QA override so both layouts are reachable on any screen: ?view=mobile
    // or ?view=desktop pins the variant; otherwise it tracks the 761px breakpoint.
    const forced = new URLSearchParams(window.location.search).get("view");
    if (forced === "mobile") { setWide(false); return; }
    if (forced === "desktop") { setWide(true); return; }
    const mq = window.matchMedia("(min-width: 761px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return wide;
}

// The wallet stack mounts HERE, not in the root layout — marketing pages must
// never pay for it. AppShellInner runs privy hooks, so it has to sit inside.
export function AppShell() {
  return (
    <Web3Providers>
      <AppShellInner />
    </Web3Providers>
  );
}

function AppShellInner() {
  const { ready, authenticated } = usePrivy();
  const chatDesktop = useChatDesktop();

  // Signed out (or Privy still booting): the aurora auth screen owns the full
  // viewport on phone AND desktop. While booting it shows just the breathing
  // orb; the headline + sign-in card materialize once Privy is ready.
  if (!ready || !authenticated) {
    return <AuthScreen ready={ready} />;
  }

  // Signed in: the chat-first design owns all of its own chrome + theme. Desktop
  // widths get the full shell; phones get the mobile variant. No MobileFrame.
  return (
    <ToastProvider>
      {chatDesktop ? <ChatApp /> : <ChatAppMobile />}
    </ToastProvider>
  );
}
