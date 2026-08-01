"use client";

// StakingPage — the in-app staking surface (full-page takeover, GrovesPage
// shell). The panel itself is shared with the public /stake page; only the
// wallet adapter differs (here: the Privy embedded EOA the user signed in with).
import { PIcon, type ChatNav, type StakingPrefill } from "./chatKit";
import { StakingPanel } from "@/components/staking/StakingPanel";
import { usePrivyStakingWallet } from "@/hooks/useStakingWallet";
import { STAKING_TESTNET } from "@/lib/staking";

export function StakingPage({ nav, onBack, mobile = false, prefill = null }: { nav: ChatNav; onBack: () => void; mobile?: boolean; prefill?: StakingPrefill | null }) {
  const wallet = usePrivyStakingWallet();
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: mobile ? "14px 16px" : "16px 24px", borderBottom: "1px solid var(--line)" }}>
        <button onClick={onBack} aria-label="Back" style={{ width: 36, height: 36, flex: "none", border: "1px solid var(--line)", borderRadius: 11, display: "grid", placeItems: "center", background: "var(--panel)", color: "var(--ink-2)" }}>
          <PIcon name="ph-caret-left" size={16} weight="bold" />
        </button>
        <span style={{ width: 40, height: 40, borderRadius: 13, flex: "none", display: "grid", placeItems: "center", background: "linear-gradient(145deg,var(--primary-2),var(--primary))", color: "#fff", boxShadow: "0 6px 14px color-mix(in srgb, var(--primary) 32%, transparent)" }}>
          <PIcon name="ph-stack" size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-.01em" }}>
            Staking
            {STAKING_TESTNET && (
              <span style={{ marginLeft: 9, padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)", verticalAlign: "2px" }}>TESTNET</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>Stake $MONVERA and earn a slice of the season pool, credited to your address every epoch. Bigger stake, bigger share, plus curator rights.</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? 16 : 24 }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {/* Sizing is container-driven now (@container in STAKING_CSS), so the
              panel adapts to this column without a `compact` flag. */}
          {/* key: a fresh prefill remounts the panel, so its INITIAL state carries
              the handed-off side and amount — no prop-to-state syncing effects. */}
          <StakingPanel key={prefill ? `chat-${prefill.nonce}` : "base"} wallet={wallet} prefill={prefill} />
        </div>
      </div>
    </div>
  );
}
