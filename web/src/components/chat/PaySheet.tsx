"use client";

// Send / receive overlay — the "Monvera Chat" design's pay sheet (design L510-544
// + script L784-798), wired REAL: send moves USDG or any held token out of the
// account via the same gasless transfer hook as the classic SendScreen
// (useTransfer → one sponsored UserOp); receive shows a live QR of the user's
// address (qrcode.react) + copy. Glass panels keep the exact
// style={{ background: "var(--panel)", ... }} idiom (theme highlight selector).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseUnits } from "viem";
import { QRCodeSVG } from "qrcode.react";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useTransfer } from "@/hooks/useTransfer";
import { haptic } from "@/lib/haptics";
import { USDG } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { fmtAmt, fromUnits, shortAddress, txUrl } from "@/lib/format";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { PIcon, usd } from "./chatKit";

export type PayMode = "send" | "receive";

// The task-level contract for a recipient: a plain 0x address on Robinhood Chain.
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// digits + a single decimal point only
const clean = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

/** Hook errors, kept short and human. */
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (/user (rejected|denied)|rejected the request|request rejected|user cancel/i.test(msg)) return "You cancelled the signature — nothing was sent.";
  return msg.length > 180 ? msg.slice(0, 177) + "…" : msg;
}

interface PayToken {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  raw: bigint;
  qty: number;
  priceUsd?: number;
  valueUsd?: number;
}

const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 };
// panel-2 (flat translucency): no blur-inside-blur within the glass modal
const searchStyle: React.CSSProperties = { width: "100%", height: 40, border: "1px solid var(--line)", outline: "none", background: "var(--panel-2)", color: "var(--ink)", borderRadius: 12, padding: "0 13px", fontSize: 13.5, fontFamily: "inherit", marginBottom: 10 };

export function PaySheet({ mode, onClose }: { mode: PayMode; onClose: () => void }) {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  // Exit mirrors the entrance: panel de-materializes, scrim fades, then unmount.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 190);
  }, [onClose]);

  const transfer = useTransfer();

  const [sendSym, setSendSym] = useState("USDG");
  const [search, setSearch] = useState("");
  const [amt, setAmt] = useState("");
  const [addr, setAddr] = useState("");
  const [recvSym, setRecvSym] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sendable assets: cash (USDG) first, then every held token (same rules as the
  // classic SendScreen — $MONVERA stays out of the gasless send path).
  const tokens: PayToken[] = useMemo(() => {
    const cash: PayToken = {
      symbol: "USDG",
      name: "Cash · USDG",
      address: USDG.address as `0x${string}`,
      decimals: USDG.decimals,
      raw: bal?.raw ?? BigInt(0),
      qty: bal?.value ?? 0,
      priceUsd: 1,
      valueUsd: bal?.value ?? 0,
    };
    const held = (port?.holdings ?? [])
      .filter((h) => h.asset.address && h.asset.decimals && h.asset.symbol !== "MONVERA")
      .map((h) => ({
        symbol: h.asset.symbol,
        name: displayFor(h.asset.symbol, h.asset.name).name,
        address: h.asset.address as `0x${string}`,
        decimals: (h.asset.decimals as number) ?? 18,
        raw: h.raw,
        qty: h.qty,
        priceUsd: h.priceUsd,
        valueUsd: h.valueUsd,
      }));
    return [cash, ...held];
  }, [bal?.raw, bal?.value, port?.holdings]);

  const q = search.toLowerCase().trim();
  const filtered = tokens.filter((t) => q === "" || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
  const sel = tokens.find((t) => t.symbol === sendSym) ?? tokens[0];

  // ── send sizing: the $ input converts to raw units via the live price ──
  const amtNum = parseFloat(amt) || 0;
  const amountRaw = (() => {
    if (!sel || amtNum <= 0 || !sel.priceUsd || sel.priceUsd <= 0) return BigInt(0);
    const qtyWanted = amtNum / sel.priceUsd;
    // At (or a hair past) the whole balance: send exactly what's held (no dust).
    if (qtyWanted >= sel.qty && qtyWanted <= sel.qty * 1.002) return sel.raw;
    try {
      return parseUnits(qtyWanted.toFixed(Math.min(sel.decimals, 18)), sel.decimals);
    } catch {
      return BigInt(0);
    }
  })();
  const overBalance = !!sel && amountRaw > sel.raw;
  const addrOk = ADDR_RE.test(addr.trim());
  const canSend = amountRaw > BigInt(0) && !overBalance && addrOk && !!address;

  // The one place in this app where an extra tap is unambiguously right:
  // sends are irreversible, so the button leads to a review step first.
  const [reviewing, setReviewing] = useState(false);
  const doSend = () => {
    if (!canSend || !sel || transfer.busy) return;
    haptic.medium();
    setReviewing(false);
    void transfer.send({
      token: sel.address,
      to: addr.trim(),
      amountRaw,
      amount: fromUnits(amountRaw, sel.decimals),
      symbol: sel.symbol,
    });
  };

  const copyAddr = async () => {
    haptic.light();
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // clipboard unavailable (permissions/iframe) — the address stays visible to select
    }
    setCopied(true);
  };

  // Escape closes (the X always works — a signed transfer finishes on-chain anyway).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !transfer.busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transfer.busy, close]);

  const sent = transfer.phase === "done" && transfer.result;
  const title = mode === "receive" ? "Receive" : sent ? "Sent" : "Send";
  const recvLabel = recvSym ? (recvSym === "USDG" ? "Cash (USDG)" : `${displayFor(recvSym).name} (${recvSym})`) : "";

  return (
    <div
      className={closing ? "fadein fadeout" : "fadein"}
      onClick={() => {
        if (!transfer.busy) close();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 96, background: "rgba(8,14,10,.22)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        className={closing ? "glassin glassout" : "glassin"}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 380, maxHeight: "92%", overflowY: "auto", background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 55%),var(--panel)", backdropFilter: "blur(14px) saturate(170%)", WebkitBackdropFilter: "blur(14px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 22, boxShadow: "0 20px 60px rgba(8,20,12,.3)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 20px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
          <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>

        <div style={{ padding: "18px 20px" }}>
          {mode === "send" && sent && transfer.result ? (
            // ── sent ──
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--primary)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
                <PIcon name="ph-check" size={30} weight="bold" style={{ color: "var(--primary-ink)" }} />
              </div>
              <div className="serif" style={{ fontSize: 20, fontWeight: 500 }}>Sent</div>
              <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "6px 0 10px", lineHeight: 1.55 }}>
                {fmtAmt(transfer.result.amount)} {transfer.result.symbol} is on its way to{" "}
                <b className="mono" style={{ color: "var(--ink)" }}>{shortAddress(transfer.result.to)}</b> — gasless, as always.
              </p>
              <a
                href={txUrl(transfer.result.txHash)}
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-block", fontSize: 12, color: "var(--primary)", fontWeight: 600, marginBottom: 14, textDecoration: "none" }}
              >
                View on Blockscout ↗
              </a>
              <button onClick={close} style={{ width: "100%", height: 44, borderRadius: 13, fontSize: 14, fontWeight: 600, background: "var(--primary)", color: "var(--primary-ink)" }}>
                Done
              </button>
            </div>
          ) : mode === "send" ? (
            // ── send ──
            <div>
              <div style={eyebrow}>Choose an asset</div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets…" style={searchStyle} />
              {filtered.map((t) => {
                const on = t.symbol === sendSym;
                return (
                  <button
                    key={t.symbol}
                    onClick={() => {
                      setSendSym(t.symbol);
                      setAmt("");
                      if (transfer.error) transfer.reset();
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 8px", border: "none", borderRadius: 12, background: on ? "var(--primary-soft)" : "transparent", textAlign: "left", marginBottom: 2 }}
                  >
                    <AssetTile asset={displayFor(t.symbol, t.name)} size={30} radius={9} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{t.name}</span>
                    <span className="tnum" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                      {t.valueUsd !== undefined ? usd(t.valueUsd) : `${fmtAmt(t.qty)} ${t.symbol}`}
                    </span>
                  </button>
                );
              })}

              <div style={{ ...eyebrow, margin: "10px 0 6px" }}>Amount</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--panel-2)", borderRadius: 13, padding: "9px 13px" }}>
                <span className="tnum" style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-3)" }}>$</span>
                <input
                  value={amt}
                  onChange={(e) => {
                    setAmt(clean(e.target.value));
                    if (transfer.error) transfer.reset();
                  }}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Amount to send in dollars"
                  className="tnum"
                  style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 18, fontWeight: 600, minWidth: 0 }}
                />
              </div>
              {overBalance && (
                <div style={{ fontSize: 12, color: "var(--neg)", fontWeight: 500, marginTop: 6 }}>
                  That&apos;s more than your {sel?.symbol} balance{sel?.valueUsd !== undefined ? ` (${usd(sel.valueUsd)})` : ""}.
                </div>
              )}

              <div style={{ ...eyebrow, margin: "10px 0 6px" }}>To</div>
              <input
                value={addr}
                onChange={(e) => {
                  setAddr(e.target.value);
                  if (transfer.error) transfer.reset();
                }}
                placeholder="0x… recipient address"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="mono"
                style={{ width: "100%", border: "1px solid var(--line)", outline: "none", background: "var(--panel-2)", color: "var(--ink)", borderRadius: 13, padding: "11px 13px", fontSize: 12.5, marginBottom: 12 }}
              />
              {addr.trim().length > 0 && !addrOk && (
                <div style={{ fontSize: 12, color: "var(--neg)", fontWeight: 500, margin: "-6px 0 12px" }}>
                  That doesn&apos;t look like a Robinhood Chain address.
                </div>
              )}

              {transfer.error && (
                <button
                  onClick={transfer.reset}
                  style={{ width: "100%", marginBottom: 12, background: "color-mix(in srgb,var(--neg) 10%,transparent)", border: "1px solid color-mix(in srgb,var(--neg) 30%,transparent)", borderRadius: 12, padding: "10px 13px", fontSize: 12.5, color: "var(--neg)", textAlign: "left", lineHeight: 1.5 }}
                >
                  {friendly(transfer.error)}
                </button>
              )}

              {reviewing && canSend && sel ? (
                <div style={{ border: "1.5px solid var(--primary)", borderRadius: 16, padding: "13px 14px", marginBottom: 4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Review before it goes</div>
                  {[
                    ["Sending", `${usd(amtNum)} · ${sel.symbol}`],
                    ["Network", "Robinhood Chain"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, marginTop: 4 }}>
                      <span style={{ color: "var(--ink-2)" }}>{k}</span>
                      <span style={{ fontWeight: 650 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-2)" }}>To</div>
                  <div className="mono" style={{ fontSize: 11.5, wordBreak: "break-all", lineHeight: 1.5, marginTop: 2 }}>{addr.trim()}</div>
                  <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--neg)", fontWeight: 600 }}>Transfers can&apos;t be undone. Check every character of the address.</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                    <button onClick={() => setReviewing(false)} style={{ flex: "none", padding: "0 15px", height: 42, borderRadius: 12, fontSize: 13, fontWeight: 600, background: "var(--panel-2)", color: "var(--ink-2)" }}>Back</button>
                    <button onClick={doSend} disabled={transfer.busy} style={{ flex: 1, height: 42, borderRadius: 12, fontSize: 13.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      {transfer.busy ? <><CircleNotch size={15} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} /> Sending…</> : "Send now"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setReviewing(true)}
                  disabled={!canSend || transfer.busy}
                  style={{ width: "100%", height: 46, borderRadius: 13, fontSize: 14.5, fontWeight: 600, background: "var(--primary)", color: "var(--primary-ink)", opacity: canSend || transfer.busy ? 1 : 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  {transfer.busy ? (
                    <>
                      <CircleNotch size={16} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} /> Sending…
                    </>
                  ) : (
                    `Review send · ${usd(amtNum)}`
                  )}
                </button>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)", marginTop: 9 }}>
                <PIcon name="ph-lock-key" size={13} weight="fill" style={{ color: "var(--primary)" }} /> Self-custody · gas on us
              </div>
            </div>
          ) : !recvSym ? (
            // ── receive: pick an asset ──
            <div>
              <div style={eyebrow}>Choose an asset to receive</div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets…" style={searchStyle} />
              {filtered.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => {
                    setRecvSym(t.symbol);
                    setCopied(false);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 8px", borderTop: "1px solid var(--line-2)", borderRadius: 0, background: "transparent", textAlign: "left" }}
                >
                  <AssetTile asset={displayFor(t.symbol, t.name)} size={30} radius={9} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{t.name}</span>
                  <PIcon name="ph-caret-right" size={14} weight="bold" style={{ color: "var(--ink-3)" }} />
                </button>
              ))}
            </div>
          ) : (
            // ── receive: QR + address ──
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Receive {recvLabel}</div>
              <div style={{ width: 178, height: 178, margin: "10px auto 0", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: 14 }}>
                {address ? (
                  <QRCodeSVG value={address} size={150} bgColor="#ffffff" fgColor="#141a16" style={{ width: "100%", height: "100%" }} />
                ) : (
                  <div style={{ fontSize: 12, color: "#5c655e", display: "grid", placeItems: "center", height: "100%" }}>Sign in to see your address</div>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 12 }}>Your Monvera address</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, background: "var(--panel-2)", borderRadius: 12, padding: "10px 12px" }}>
                <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                  {address ?? "—"}
                </span>
                <button onClick={() => void copyAddr()} style={{ flex: "none", height: 30, padding: "0 12px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: "var(--primary)", color: "var(--primary-ink)" }}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 9, textAlign: "left", background: "color-mix(in srgb,var(--neg) 10%,transparent)", border: "1px solid color-mix(in srgb,var(--neg) 30%,transparent)", borderRadius: 12, padding: "11px 13px", marginTop: 12 }}>
                <Warning size={16} weight="fill" style={{ color: "var(--neg)", flex: "none", marginTop: 1 }} />
                <span style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  Only send <b style={{ color: "var(--ink)" }}>{recvLabel}</b> on Robinhood Chain to this address. Any other asset or network may be lost forever.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
