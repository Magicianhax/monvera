"use client";

// Top-level signed-in/out router.
//
// Signed in, the reskinned design owns its own full-screen chrome (status-bar
// padding, hero, bottom TabBar) and provides both the Lite invest loop AND the
// browse/trade/receipt tabs in one unified app, so we mount LiteApp directly
// inside the phone frame.
import { usePrivy } from "@privy-io/react-auth";
import { LandingScreen } from "@/components/lite/screens/LandingScreen";
import { LiteApp } from "@/components/lite/LiteApp";
import { MobileFrame } from "./MobileFrame";

function LoadingScreen() {
  return (
    <div className="screen" style={{ alignItems: "center", justifyContent: "center" }}>
      <span
        className="spin"
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "3px solid color-mix(in srgb, var(--primary) 30%, transparent)",
          borderTopColor: "var(--primary)",
          display: "inline-block",
        }}
      />
    </div>
  );
}

export function AppShell() {
  const { ready, authenticated } = usePrivy();

  // Wait for Privy before painting auth-gated UI.
  if (!ready) {
    return (
      <MobileFrame>
        <LoadingScreen />
      </MobileFrame>
    );
  }

  if (!authenticated) {
    return (
      <MobileFrame>
        <LandingScreen />
      </MobileFrame>
    );
  }

  // Signed in: the reskinned, full-screen design owns all of its own chrome.
  return (
    <MobileFrame>
      <LiteApp />
    </MobileFrame>
  );
}
