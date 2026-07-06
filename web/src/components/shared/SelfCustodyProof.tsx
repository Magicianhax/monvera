"use client";

// Self-custody proof — a plain, checkable statement that the user's money sits
// in their own account, held by their own key, and that Monvera cannot move it.
// Reads the live address + total value and links out to the block explorer, so
// the claim is verifiable rather than just asserted. Self-contained (reads its
// own hooks) so any screen can drop it in with a single line.
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { usePortfolio, useUsdcBalance } from "@/hooks/useBalances";
import { Icon } from "@/components/design";
import { usd, shortAddress, addressUrl } from "@/lib/format";

const CLAIMS = [
  "Only your key can move this money.",
  "Monvera cannot move it, freeze it, or spend it.",
  "You can check this account on the block explorer any time.",
];

export function SelfCustodyProof() {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);

  const total = (bal?.value ?? 0) + (port?.investedUsd ?? 0);
  const ready = Boolean(address);

  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="lock" size={18} stroke={2} style={{ color: "var(--primary)", flex: "none" }} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>Your money, your keys</span>
      </div>

      {/* the account itself + its live value */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          background: "var(--glass-bg-2)",
          borderRadius: "var(--r-lg)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 500 }}>This account holds your funds</div>
          <div className="mono" style={{ fontSize: 13.5, marginTop: 3 }}>{ready ? shortAddress(address ?? undefined) : "…"}</div>
        </div>
        <div className="tnum" style={{ fontSize: 16, fontWeight: 600, flex: "none" }}>{ready ? usd(total) : "—"}</div>
      </div>

      {/* the plain claims */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {CLAIMS.map((line) => (
          <div key={line} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
            <Icon name="check" size={15} stroke={2.2} style={{ color: "var(--primary)", flex: "none", marginTop: 1 }} />
            <span>{line}</span>
          </div>
        ))}
      </div>

      {/* verify for yourself */}
      <a
        href={ready ? addressUrl(address as string) : undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="tap"
        aria-disabled={!ready}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "11px 14px",
          borderRadius: "var(--rr)",
          background: "var(--surface-2)",
          boxShadow: "var(--shadow)",
          fontSize: 13.5,
          fontWeight: 500,
          pointerEvents: ready ? "auto" : "none",
          opacity: ready ? 1 : 0.55,
        }}
      >
        Inspect on Blockscout
        <Icon name="arrowUR" size={15} style={{ color: "var(--ink-2)", flex: "none" }} />
      </a>
    </div>
  );
}
