"use client";

// Export private key — a self-custody escape hatch. The key is the master
// credential for the account; whoever holds it can drain it, and no one can undo
// that or recover a lost one. So this is a deliberate, warning-gated action, and
// the reveal itself happens inside PRIVY'S OWN iframe (useExportWallet): the key
// is decrypted in Privy's isolated frame and shown to the user directly. Monvera
// code, logs, and servers never see it — we only open the modal.
import { useState } from "react";
import { useExportWallet } from "@privy-io/react-auth";
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { Icon, BottomSheet } from "@/components/design";

const CONSEQUENCES = [
  "Anyone who sees this key can take everything in your account. Treat it like the key to a safe.",
  "Monvera can never reset it or get your money back if it leaks. There is no support line for a stolen key.",
  "We never store it, and we cannot recover it if you lose it. This is the one secret only you hold.",
  "Never paste it into a website, a chat, a form, or a screen-share. Real staff will never ask for it.",
] as const;

export function ExportKey() {
  const { exportWallet } = useExportWallet();
  const wallet = useActiveWallet();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    if (!wallet?.address) return;
    setBusy(true);
    try {
      // Opens Privy's isolated export modal. The key is shown there, by Privy,
      // to the user — it never returns to our code.
      await exportWallet({ address: wallet.address });
      setOpen(false);
      setAck(false);
    } finally {
      setBusy(false);
    }
  };

  // Bring-your-own-wallet users have no embedded key for us to export.
  if (!wallet || wallet.walletClientType !== "privy") return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="row tap"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", background: "none" }}
      >
        <Icon name="lock" size={18} style={{ color: "var(--ink-2)", flex: "none" }} />
        <span style={{ flex: 1, textAlign: "left", fontWeight: 500, fontSize: 15.5, letterSpacing: "-.005em" }}>
          Export private key
        </span>
        <Icon name="chevR" size={16} style={{ color: "var(--ink-3)" }} />
      </button>

      <BottomSheet open={open} onClose={() => !busy && setOpen(false)} title="Export your private key">
        <div style={{ paddingBottom: 4 }}>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Your private key is the single password to this account. Exporting it lets you use the account
            in another wallet like MetaMask. It also means the safety of your money is entirely in your
            hands from that moment on. Read this before you continue.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {CONSEQUENCES.map((c, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  background: "color-mix(in srgb, var(--neg) 9%, var(--surface))",
                  borderRadius: "var(--rr)",
                  padding: "11px 13px",
                }}
              >
                <Icon name="shield" size={15} style={{ color: "var(--neg)", flex: "none", marginTop: 1 }} />
                <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{c}</span>
              </div>
            ))}
          </div>

          <label
            className="tap"
            style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", marginBottom: 16 }}
          >
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              style={{ width: 17, height: 17, accentColor: "var(--neg)", flex: "none", marginTop: 1 }}
            />
            <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5 }}>
              I understand that anyone with this key controls my money, that it cannot be recovered, and
              that no one from Monvera will ever ask me for it.
            </span>
          </label>

          <button
            onClick={reveal}
            disabled={!ack || busy}
            className="btn btn-primary btn-block btn-lg tap"
            style={{ opacity: !ack || busy ? 0.5 : 1 }}
          >
            {busy ? "Opening…" : "I understand, reveal my key"}
          </button>
          <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            The key is shown by your wallet provider, in a secure window. Monvera never sees it.
          </p>
        </div>
      </BottomSheet>
    </>
  );
}
