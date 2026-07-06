"use client";

// DemoMount — the real Monvera app, rendered with demo data and no auth gate, for
// the marketing site. Reuses the actual LiteApp + screens (full fidelity) under
// <DemoProvider>; the app's own `.stax` theme scope is recreated here (instead of
// MobileFrame's useTheme) so the embedding page can pin light/dark and a play script.
import { ToastProvider } from "@/components/design/Toast";
import { DemoProvider, type DemoPlay } from "@/components/demo/DemoProvider";
import { LiteApp } from "@/components/lite/LiteApp";

export function DemoMount({
  play = null,
  mode = "dark",
}: {
  play?: DemoPlay;
  mode?: "light" | "dark";
}) {
  return (
    <DemoProvider play={play}>
      <div className="stax-backdrop" data-mode={mode}>
        <div className="stax" data-theme="soft" data-mode={mode}>
          <ToastProvider>
            <LiteApp demoPlay={play} />
          </ToastProvider>
        </div>
      </div>
    </DemoProvider>
  );
}
