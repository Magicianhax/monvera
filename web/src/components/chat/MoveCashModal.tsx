"use client";

// The "move Grove cash to spendable" flow, as a real popup — progress, then a
// success beat — instead of a button that quietly spins and stops. Same shell
// and beats as the Grove buy/exit modals, so every money action in the app
// moves the same way.
//
// The modal STARTS the move on mount: the triggering button already said what
// will happen ("Move to cash"), so a second confirm screen would be a speed
// bump, not safety — the transfer is between the user's own two accounts.
import { useEffect, useRef, useState } from "react";
import type { useLegacyRecover } from "@/hooks/useLegacyRecover";
import { GroveModal, ModalDoneButton, ModalSuccessIcon, ModalWorking } from "./GroveModal";
import { usd } from "./chatKit";

export function MoveCashModal({ r, onClose }: { r: ReturnType<typeof useLegacyRecover>; onClose: () => void }) {
  // Captured at mount: the balance zeroes optimistically on success, and a
  // success screen reading "$0.00 moved" would be nonsense.
  const [amountUsd] = useState(r.usdValue);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void r.recover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GroveModal title="Move to cash" onClose={onClose} busy={r.phase === "moving"}>
      {r.phase === "done" ? (
        <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <ModalSuccessIcon />
          <div className="serif" style={{ fontSize: 20, fontWeight: 500 }}>Moved to cash</div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 12px", lineHeight: 1.55 }}>
            <span className="tnum">{usd(amountUsd)}</span> is now in your cash wallet, spendable everywhere.
          </p>
          {r.txHash && (
            <a
              href={`https://robinhoodchain.blockscout.com/tx/${r.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono"
              style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              View transaction
            </a>
          )}
          <ModalDoneButton />
        </div>
      ) : r.phase === "error" ? (
        <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <div style={{ fontSize: 13, color: "var(--neg)", lineHeight: 1.55 }}>{r.error ?? "The move didn't go through."}</div>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6 }}>Your money hasn&rsquo;t moved — it is still in your Grove account.</div>
          <button
            onClick={() => void r.recover()}
            style={{ display: "block", width: "100%", height: 44, marginTop: 14, borderRadius: 13, fontSize: 13.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)" }}
          >
            Try again
          </button>
          <ModalDoneButton />
        </div>
      ) : (
        <ModalWorking title={`Moving ${usd(amountUsd)} to cash`} step="One gasless transaction between your own accounts…" />
      )}
    </GroveModal>
  );
}
