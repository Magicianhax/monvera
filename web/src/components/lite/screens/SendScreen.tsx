"use client";

// Send — move USDG or any held token out of the smart account to a Robinhood Chain
// address. Pick an asset, enter amount + recipient, confirm, and it goes as one
// gasless transfer (useTransfer). Real funds: address is validated, amount is
// capped to the balance, and a confirm step guards against accidental sends.
import { useMemo, useState } from "react";
import { isAddress, parseUnits } from "viem";
import { useUsdcBalance, usePortfolio } from "@/hooks/useBalances";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useTransfer } from "@/hooks/useTransfer";
import { Icon } from "@/components/design";
import { TokenLogo } from "@/components/lite/TokenLogo";
import { USDG } from "@/lib/tokens";
import { usd, tokenQty, fromUnits, shortAddress, txUrl } from "@/lib/format";
import { iconBtn, Spinner } from "./primitives";

interface Sendable {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  raw: bigint;
  priceUsd?: number; // USD per whole token (USDG = 1)
}

export function SendScreen({
  go,
  symbol: initialSymbol,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  symbol?: string;
}) {
  const { address } = useSmartAccount();
  const { data: bal } = useUsdcBalance(address ?? undefined);
  const { data: port } = usePortfolio(address ?? undefined);
  const transfer = useTransfer();

  // Sendable assets: cash (USDG) first, then every held token.
  const assets: Sendable[] = useMemo(() => {
    const cash: Sendable = {
      symbol: "USDG",
      name: "US Dollar",
      address: USDG.address as `0x${string}`,
      decimals: USDG.decimals,
      raw: bal?.raw ?? BigInt(0),
      priceUsd: 1,
    };
    const held = (port?.holdings ?? [])
      .filter((h) => h.asset.address && h.asset.decimals)
      .map((h) => ({
        symbol: h.asset.symbol,
        name: h.asset.name,
        address: h.asset.address as `0x${string}`,
        decimals: h.asset.decimals as number,
        raw: h.raw,
        priceUsd: h.priceUsd,
      }));
    return [cash, ...held];
  }, [bal?.raw, port?.holdings]);

  const [sel, setSel] = useState(() => {
    const i = assets.findIndex((a) => a.symbol === initialSymbol);
    return i >= 0 ? i : 0;
  });
  const asset = assets[Math.min(sel, assets.length - 1)];

  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);

  const balanceNum = fromUnits(asset.raw, asset.decimals);
  const amountNum = Number(amount) || 0;
  const amountRaw = (() => {
    try {
      return amount ? parseUnits(amount, asset.decimals) : BigInt(0);
    } catch {
      return BigInt(0);
    }
  })();
  const usdValue = asset.priceUsd !== undefined ? amountNum * asset.priceUsd : undefined;

  const addrValid = isAddress(to.trim());
  const overBalance = amountRaw > asset.raw;
  const canReview = amountRaw > BigInt(0) && !overBalance && addrValid;

  const setMax = () => setAmount(String(balanceNum));

  const onSend = () => {
    void transfer.send({
      token: asset.address,
      to: to.trim(),
      amountRaw,
      amount: amountNum,
      symbol: asset.symbol,
    });
  };

  // ── success ─────────────────────────────────────────────────────────────────
  if (transfer.phase === "done" && transfer.result) {
    const r = transfer.result;
    return (
      <div className="screen screen-pad-top" style={{ display: "flex", flexDirection: "column" }}>
        <div
          className="anim-rise"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px", textAlign: "center", gap: 16 }}
        >
          <span style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}>
            <Icon name="check" size={38} stroke={2.4} />
          </span>
          <div>
            <h1 className="serif" style={{ margin: 0, fontSize: 28, letterSpacing: "-.01em" }}>Sent</h1>
            <p style={{ margin: "8px 0 0", fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {r.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {r.symbol} to{" "}
              <b className="mono" style={{ color: "var(--ink)" }}>{shortAddress(r.to)}</b>
            </p>
          </div>
          <a className="caption" href={txUrl(r.txHash)} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            View on Blockscout <Icon name="arrowUR" size={14} />
          </a>
        </div>
        <div style={{ padding: "0 22px calc(20px + env(safe-area-inset-bottom))" }}>
          <button className="btn btn-primary btn-block btn-lg tap" onClick={() => go("wallet")}>Done</button>
        </div>
      </div>
    );
  }

  // ── compose ─────────────────────────────────────────────────────────────────
  return (
    <div className="screen screen-pad-top" style={{ display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Send</h1>
      </div>

      <div style={{ padding: "16px 22px 0", flex: 1, overflowY: "auto" }}>
        {/* asset selector */}
        <div className="label-eyebrow" style={{ marginBottom: 8 }}>Asset</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
          {assets.map((a, i) => {
            const on = i === sel;
            return (
              <button
                key={a.symbol}
                onClick={() => { setSel(i); setAmount(""); setConfirming(false); }}
                className="tap"
                style={{
                  flex: "none",
                  padding: "8px 14px 8px 8px",
                  borderRadius: 5,
                  background: on ? "var(--primary)" : "var(--surface-2)",
                  color: on ? "var(--primary-ink)" : "var(--ink)",
                  fontWeight: 500,
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  minWidth: 84,
                }}
              >
                <TokenLogo symbol={a.symbol} name={a.name} size={30} />
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                  <span>{a.symbol}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, opacity: on ? 0.85 : 0.6 }}>
                    {tokenQty(a.raw, a.decimals)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* amount */}
        <div className="label-eyebrow" style={{ marginBottom: 8 }}>Amount</div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setConfirming(false); }}
              className="tnum"
              style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 34, fontWeight: 600, letterSpacing: "-.03em", color: "var(--ink)" }}
            />
            <span style={{ fontWeight: 600, fontSize: 16, color: "var(--ink-2)" }}>{asset.symbol}</span>
            <button onClick={setMax} className="tap" style={{ padding: "6px 11px", borderRadius: 4, background: "var(--surface-2)", color: "var(--primary)", fontWeight: 600, fontSize: 13 }}>
              Max
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5, color: "var(--ink-2)" }}>
            <span>{usdValue !== undefined ? `≈ ${usd(usdValue)}` : " "}</span>
            <span className="tnum">Balance {tokenQty(asset.raw, asset.decimals)} {asset.symbol}</span>
          </div>
        </div>
        {overBalance && (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--neg)", fontWeight: 500 }}>
            That&apos;s more than your {asset.symbol} balance.
          </div>
        )}

        {/* recipient */}
        <div className="label-eyebrow" style={{ margin: "18px 0 8px" }}>To</div>
        <div className="card" style={{ padding: "4px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <input
            placeholder="Robinhood address (0x…)"
            value={to}
            onChange={(e) => { setTo(e.target.value); setConfirming(false); }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="mono"
            style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 16, padding: "14px 0", color: "var(--ink)" }}
          />
          {to.trim().length > 0 && (
            <Icon
              name={addrValid ? "check" : "close"}
              size={18}
              stroke={2.2}
              style={{ color: addrValid ? "var(--primary)" : "var(--ink-3)", flex: "none" }}
            />
          )}
        </div>

        {/* safety note */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", marginTop: 16, borderRadius: 6, background: "var(--accent-soft)", color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.5 }}>
          <Icon name="info" size={16} stroke={2} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
          <span>
            Double-check the address, on <b style={{ color: "var(--ink)" }}>Robinhood Chain</b>. Transfers can&apos;t be undone.
          </span>
        </div>

        {transfer.error && (
          <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--neg)", fontWeight: 500 }}>{transfer.error}</div>
        )}
      </div>

      {/* pinned action */}
      <div style={{ position: "sticky", bottom: 0, padding: "12px 22px calc(18px + env(safe-area-inset-bottom))", background: "linear-gradient(to top, var(--paper), var(--paper) 64%, transparent)" }}>
        {!confirming ? (
          <button
            className="btn btn-primary btn-block btn-lg tap"
            disabled={!canReview}
            style={{ opacity: canReview ? 1 : 0.5 }}
            onClick={() => setConfirming(true)}
          >
            Review
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ textAlign: "center", fontSize: 14, color: "var(--ink-2)" }}>
              Send <b className="tnum" style={{ color: "var(--ink)" }}>{amountNum.toLocaleString("en-US", { maximumFractionDigits: 6 })} {asset.symbol}</b>
              {" to "}
              <b className="mono" style={{ color: "var(--ink)" }}>{shortAddress(to.trim())}</b>
            </div>
            <button className="btn btn-primary btn-block btn-lg tap" disabled={transfer.busy} onClick={onSend}>
              {transfer.busy ? <Spinner small /> : "Send now"}
            </button>
            {!transfer.busy && (
              <button className="btn btn-ghost btn-block tap" onClick={() => setConfirming(false)}>Edit</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
