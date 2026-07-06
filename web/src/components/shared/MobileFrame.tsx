"use client";

// Mobile app shell for Monvera (Soft theme). The app renders at mobile resolution:
// full-bleed on phones, and centered at a phone width on larger screens. No
// skeuomorphic device frame (no bezel, dynamic island, or home indicator).
//
//   .stax-backdrop  → page backdrop (light/dark)
//     .stax         → theme wrapper (data-mode drives all CSS vars), mobile-width
//       ToastProvider → app content + transient confirmations
import { ToastProvider } from "@/components/design/Toast";
import { useTheme } from "@/hooks/useTheme";

export function MobileFrame({ children }: { children: React.ReactNode }) {
  const { colorMode } = useTheme();

  return (
    <div className="stax-backdrop" data-mode={colorMode}>
      <div className="stax" data-theme="soft" data-mode={colorMode}>
        <ToastProvider>{children}</ToastProvider>
      </div>
    </div>
  );
}
