"use client";

// App-top action bar: USDG sitting at the smart account (Grove-exit proceeds),
// one tap from spendable. It used to live only inside the Wallet canvas, where
// a user who never opened Wallet simply never learned they had cash to move —
// money actions must be visible where the user already is, not filed away.
//
// Honest framing: that cash already funds Grove buys automatically (useGroveBuy
// spends it first), so the bar offers the move without nagging — one slim row,
// spinner while the sponsored transfer runs, gone the moment the balance is.
import { useState } from "react";
import { useLegacyRecover } from "@/hooks/useLegacyRecover";
import { MoveCashModal } from "./MoveCashModal";
import { PIcon, usd } from "./chatKit";

export function RecoverBanner() {
  const r = useLegacyRecover();
  // The popup owns progress + success; the bar just opens it.
  const [open, setOpen] = useState(false);
  // Dust never earns a bar. The Wallet's two-account cards still show cents.
  // The bar stays while the modal runs (balance zeroes only on success).
  if (!open && (!r.hasFunds || r.usdValue < 0.5)) return null;

  return (
    <>
      {r.hasFunds && r.usdValue >= 0.5 && (
        <div
          role="status"
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--line)", background: "color-mix(in srgb, var(--primary) 9%, transparent)" }}
        >
          <PIcon name="ph-coins" size={15} weight="fill" style={{ color: "var(--primary)", flex: "none" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <b className="tnum" style={{ color: "var(--ink)" }}>{usd(r.usdValue)}</b> in your Grove account — funds Grove buys automatically, or move it to spendable cash.
          </span>
          <button
            onClick={() => setOpen(true)}
            disabled={open}
            style={{ flex: "none", height: 30, padding: "0 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", cursor: open ? "default" : "pointer" }}
          >
            Move to cash
          </button>
        </div>
      )}
      {open && <MoveCashModal r={r} onClose={() => setOpen(false)} />}
    </>
  );
}
