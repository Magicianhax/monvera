"use client";

// Activity — a user's REAL money movement on-chain: every Buy, Sell, Send and
// Receive, newest first, each row opening its on-chain receipt. Derived from the
// wallet's token transfers (useTransactions) grouped into human events, so a
// trade's two legs read as one "Bought AAPL" line.
import { useState } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { Icon, VerifiedBadge } from "@/components/design";
import { ActivityGlyph } from "@/components/lite/ActivityGlyph";
import { usd, fmtAmt, relTime, shortAddress } from "@/lib/format";
import { toWalletEvents, eventLabel } from "@/lib/walletActivity";
import { iconBtn, Pager, innerBox } from "./primitives";

const PER_PAGE = 15;

// A friendly day header for an event's timestamp: Today / Yesterday / weekday /
// "Mar 4". Undated events fall under "Earlier".
function dateLabel(ts?: number): string {
  if (!ts) return "Earlier";
  const d = new Date(ts * 1000);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(now.getFullYear() === d.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function ActivityScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const { data: txs, isLoading } = useTransactions(address ?? undefined);
  const rows = toWalletEvents(txs ?? []);

  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  // Group this page's events into date sections (rows are already newest-first).
  const groups: { label: string; items: typeof pageRows }[] = [];
  for (const e of pageRows) {
    const label = dateLabel(e.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  const renderEvent = (e: (typeof pageRows)[number], i: number) => {
    const { verb, positive } = eventLabel(e);
    const isTrade = e.kind === "buy" || e.kind === "sell";
    const rightMain = isTrade
      ? `${positive ? "+" : "−"}${usd(e.usdgAmount ?? 0)}`
      : `${positive ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
    const usdgLeg = `${e.kind === "buy" ? "−" : "+"}${usd(e.usdgAmount ?? 0)}`;
    const assetLeg = `${e.kind === "buy" ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
    const sub = isTrade
      ? e.timestamp
        ? relTime(e.timestamp)
        : "Swap"
      : `${shortAddress(e.counterparty)}${e.timestamp ? ` · ${relTime(e.timestamp)}` : ""}`;
    return (
      <button
        key={`${e.hash}-${i}`}
        onClick={() =>
          go("receipt", {
            kind: e.kind,
            symbol: e.symbol,
            assetAmount: e.amount,
            usdgAmount: e.usdgAmount,
            counterparty: e.counterparty,
            txHash: e.hash,
            ts: e.timestamp,
          })
        }
        className="tap"
        style={{ ...innerBox }}
      >
        <ActivityGlyph event={e} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {verb} {e.symbol}
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {sub}
          </div>
        </div>
        {isTrade ? (
          <div className="tnum" style={{ textAlign: "right", flex: "none" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: e.kind === "sell" ? "var(--pos)" : "var(--ink)" }}>{usdgLeg}</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1, color: e.kind === "buy" ? "var(--pos)" : "var(--ink-2)" }}>{assetLeg}</div>
          </div>
        ) : (
          <span className="tnum" style={{ fontWeight: 700, fontSize: 15, color: positive ? "var(--pos)" : "var(--ink)", flex: "none" }}>
            {rightMain}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>
          Activity
        </h1>
      </div>

      <div style={{ padding: "18px 22px 0" }}>
        {isLoading && rows.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="card"
                style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 16px" }}
              >
                <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 14, flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "50%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "32%", height: 11, borderRadius: 6, marginTop: 7 }} />
                </div>
                <div className="skeleton" style={{ width: 60, height: 15, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Nothing yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Your buys, sells, and transfers will show up here, each with its on-chain receipt.
            </div>
          </div>
        ) : (
          <div className="stagger-in" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {groups.map((g) => (
              <div key={g.label}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", letterSpacing: ".02em", padding: "0 6px 8px" }}>
                  {g.label}
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.items.map((e, i) => renderEvent(e, i))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {rows.length > PER_PAGE && <Pager page={safePage} pageCount={pageCount} onPage={setPage} />}
      </div>

      <div style={{ padding: "18px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
      </div>
    </div>
  );
}
