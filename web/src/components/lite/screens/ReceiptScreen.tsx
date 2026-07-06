"use client";

// Receipt — the on-chain record for one money event, framed in plain words.
// Handles both a wallet event (Bought / Sold / Sent / Received, via `kind`) and
// the legacy plan receipt (title + amount). Live records link to Blockscout.
import type { IconName } from "@/components/design";
import { Icon, Seal } from "@/components/design";
import { usd, fmtAmt, shortAddress, txUrl } from "@/lib/format";
import { iconBtn } from "./primitives";

type EventKind = "buy" | "sell" | "send" | "receive";

const KIND_META: Record<EventKind, { verb: string; icon: IconName; positive: boolean }> = {
  buy: { verb: "Bought", icon: "spark", positive: false },
  sell: { verb: "Sold", icon: "trend", positive: true },
  send: { verb: "Sent", icon: "arrowUR", positive: false },
  receive: { verb: "Received", icon: "arrowDR", positive: true },
};

export function ReceiptScreen({
  go,
  title = "Invested in a plan",
  amount,
  txHash,
  ref,
  date = "Today, just now",
  kind,
  symbol,
  assetAmount,
  usdgAmount,
  counterparty,
  ts,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  title?: string;
  amount?: number;
  txHash?: string;
  ref?: string;
  date?: string;
  kind?: EventKind;
  symbol?: string;
  assetAmount?: number;
  usdgAmount?: number;
  counterparty?: string;
  ts?: number;
}) {
  const explorerHref = txHash ? txUrl(txHash) : undefined;
  const meta = kind ? KIND_META[kind] : null;
  const isTrade = kind === "buy" || kind === "sell";

  // Hero: for an event, use its verb + kind icon; else the plan receipt.
  const heroTitle = meta && symbol ? `${meta.verb} ${symbol}` : title;
  const heroIcon: IconName = meta ? meta.icon : "check";
  const heroPositive = meta ? meta.positive : true;
  const heroValue = meta
    ? isTrade
      ? usd(usdgAmount ?? 0)
      : `${fmtAmt(assetAmount ?? 0)} ${symbol ?? ""}`
    : amount !== undefined
      ? usd(Math.abs(amount))
      : undefined;
  const heroDate = ts
    ? new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : date;

  // Detail rows, tailored to the event.
  const rows: [string, React.ReactNode][] = meta
    ? kind === "buy"
      ? [
          ["Status", <Positive key="s">Completed</Positive>],
          ["Network cost", <Positive key="n">Free</Positive>],
          ["Spent", usd(usdgAmount ?? 0)],
          ["Received", `${fmtAmt(assetAmount ?? 0)} ${symbol}`],
          ["Network", "Robinhood Chain"],
        ]
      : kind === "sell"
        ? [
            ["Status", <Positive key="s">Completed</Positive>],
            ["Network cost", <Positive key="n">Free</Positive>],
            ["Sold", `${fmtAmt(assetAmount ?? 0)} ${symbol}`],
            ["Received", usd(usdgAmount ?? 0)],
            ["Network", "Robinhood Chain"],
          ]
        : kind === "send"
          ? [
              ["Status", <Positive key="s">Completed</Positive>],
              ["Network cost", <Positive key="n">Free</Positive>],
              ["Sent", `${fmtAmt(assetAmount ?? 0)} ${symbol}`],
              ["To", shortAddress(counterparty)],
              ["Network", "Robinhood Chain"],
            ]
          : [
              ["Status", <Positive key="s">Completed</Positive>],
              ["Received", `${fmtAmt(assetAmount ?? 0)} ${symbol}`],
              ["From", shortAddress(counterparty)],
              ["Network", "Robinhood Chain"],
            ]
    : [
        ["Status", <Positive key="s">Completed</Positive>],
        ["Network cost", <Positive key="n">Free</Positive>],
        ["Paid from", "Your Monvera balance"],
        ["Ownership", "Real shares, held by you"],
      ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, marginLeft: 4, fontSize: 24, letterSpacing: "-.01em" }}>
          Receipt
        </h1>
      </div>

      <div className="anim-rise" style={{ padding: "20px 22px 0", textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: heroPositive ? "color-mix(in srgb, var(--pos) 15%, transparent)" : "var(--primary-soft)",
            display: "grid",
            placeItems: "center",
            color: heroPositive ? "var(--pos)" : "var(--primary)",
            margin: "0 auto 14px",
          }}
        >
          <Icon name={heroIcon} size={30} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>{heroTitle}</div>
        {heroValue !== undefined && (
          <div
            className="tnum"
            style={{ fontSize: 32, fontWeight: 600, marginTop: 6, color: heroPositive ? "var(--pos)" : "var(--ink)" }}
          >
            {heroValue}
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>{heroDate}</div>
      </div>

      {/* details */}
      <div style={{ padding: "24px 22px 0" }}>
        <div className="card" style={{ padding: "6px 18px" }}>
          {rows.map(([k, v], i) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "13px 0",
                borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none",
                fontSize: 14.5,
              }}
            >
              <span style={{ color: "var(--ink-2)" }}>{k}</span>
              <span className="tnum" style={{ fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* on-chain record (plain words) */}
      <div style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: 18, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 11 }}>
            <Seal size={30} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em" }}>Permanent record</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>Signed &amp; recorded on-chain</div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "12px auto 14px", lineHeight: 1.55, maxWidth: 330 }}>
            This can&apos;t be edited or deleted, and anyone can check it. It&apos;s how Vera&apos;s
            track record stays honest.
          </p>
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-glass btn-block tap"
              style={{ height: 46, fontSize: 14.5, textDecoration: "none" }}
            >
              View on Blockscout <Icon name="arrowUR" size={16} />
            </a>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
              {ref ? `Reference ${ref}` : "Recorded on-chain"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Positive({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--pos)", fontWeight: 500 }}>{children}</span>;
}
