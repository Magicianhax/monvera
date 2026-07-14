"use client";

// Home — Ledger overview. Edge-to-edge sections, hairline rows, centered
// balance hero. Wired to REAL data: spendable cash from usePortfolio, invested
// holdings + approximate USD value. Balance-privacy eye toggle masks figures.
//
// Note on P&L: we don't track cost basis on-chain, so we DON'T fabricate an
// "all time" gain. The balance block shows real total value; per-holding rows
// show the approximate current value.
import { useState, type CSSProperties, type ReactNode } from "react";
import { usePortfolio, type Holding } from "@/hooks/useBalances";
import { useTransactions } from "@/hooks/useTransactions";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { WatchlistCard } from "@/components/lite/WatchlistCard";
import { MoversStrip } from "@/components/lite/MoversStrip";
import {
  Icon,
  type IconName,
  VeraOrb,
  CountUp,
  AssetTile,
  Sparkline,
  VerifiedBadge,
} from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, tokenQty, fmtAmt } from "@/lib/format";
import { toWalletEvents, eventLabel } from "@/lib/walletActivity";
import { ActivityGlyph } from "@/components/lite/ActivityGlyph";
import { useNotifications } from "@/hooks/useNotifications";
import { useMonveraPrice } from "@/hooks/useMonveraToken";
import { iconBtn, boxHead, innerBox } from "./primitives";

const DOTS = "••••••";

// Ledger section header — strong sans in the 22px gutter.
function LedgerHeader({ children, tight }: { children: ReactNode; tight?: boolean }) {
  return (
    <h2
      style={{
        margin: `${tight ? 16 : 28}px 22px 10px`,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: ".01em",
        color: "var(--ink-2)",
      }}
    >
      {children}
    </h2>
  );
}

// Ledger row grammar shared by holdings + activity + view-all rows.
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 13,
  width: "100%",
  padding: "14px 22px",
  textAlign: "left",
  background: "none",
};

// Section frame: full-width, bounded by 1px --line hairlines top + bottom.
const sectionStyle: CSSProperties = {
  borderTop: "1px solid var(--line)",
  borderBottom: "1px solid var(--line)",
};

const hairline = "1px solid var(--line-2)";

// One tap target in the flat quick-action strip.
function QuickAction({
  icon,
  label,
  sub,
  loading,
  onClick,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  loading?: boolean;
  onClick: () => void;
}) {
  // A floating soft box like the app's cards (surface + feathered shadow), with
  // a whisper of the chosen brand color so it stays lively but consistent.
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "14px 10px",
        textAlign: "center",
        background: "color-mix(in srgb, var(--primary) 12%, var(--glass-bg))",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderRadius: "var(--rr)",
        boxShadow: "var(--shadow)",
      }}
    >
      <Icon name={icon} size={19} style={{ color: "var(--primary)" }} />
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</span>
      {loading ? (
        // First-load: skeleton bar in the sub slot — no $0.00 dressed as real.
        <span className="skeleton" style={{ width: 64, height: 12, borderRadius: 4, marginTop: -2 }} />
      ) : sub !== undefined && (
        <span
          className="tnum"
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            marginTop: -2,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </span>
      )}
    </button>
  );
}

// A slim secondary action — icon + label on one line. Sits in a row that spans
// the same width as the three quick-action cards, surfacing things that would
// otherwise be buried (Activity, Watchlist, Discover).
function SlimAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "10px 8px",
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderRadius: "var(--r)",
        boxShadow: "var(--shadow)",
      }}
    >
      <Icon name={icon} size={16} style={{ color: "var(--ink-2)", flex: "none" }} />
      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
  );
}

// First-load ledger skeleton — mirrors the row grammar (tile · two text lines ·
// right value) so sections land in place with no blank area or spinner.
function SkeletonLedger({ rows, tile }: { rows: number; tile: number }) {
  return (
    <section aria-hidden>
      <div className="skeleton" style={{ width: 96, height: 13, borderRadius: 4, margin: "28px 22px 10px" }} />
      <div style={sectionStyle}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ ...rowStyle, borderBottom: i < rows - 1 ? hairline : "none" }}>
            <div className="skeleton" style={{ width: tile, height: tile, borderRadius: tile > 38 ? 6 : 5, flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="skeleton" style={{ width: 118, height: 14, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 74, height: 11, borderRadius: 4, marginTop: 6 }} />
            </div>
            <div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomeScreen({
  go,
}: {
  go: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const unread = useNotifications().data?.unread ?? 0;
  const { data: tok } = useMonveraPrice();
  const { address } = useSmartAccount();
  // Cash, invested, and total all arrive pre-computed from /api/portfolio —
  // this screen renders them verbatim (no client-side money math).
  const { data: port, isLoading: portLoading } = usePortfolio(address ?? undefined);
  const { data: txs, isLoading: activityLoading } = useTransactions(address ?? undefined);
  const [hideBalance, setHideBalance] = useState(false);

  const balance = port?.cashUsd ?? 0;
  const holdings: Holding[] = port?.holdings ?? [];
  const invested = port?.investedUsd ?? 0;
  const total = port?.totalUsd ?? 0;

  // First-load skeleton (only the initial fetch; interval refetches keep the value).
  const balanceLoading = portLoading;
  // Overflow guard: shrink the balance numeral as the formatted value gets longer,
  // so a 7-figure balance never spills past the frame.
  const balLen = usd(total).length;
  const balSize = balLen <= 9 ? 48 : balLen <= 11 ? 40 : 34;

  const shownHoldings = holdings.slice(0, 5);
  const events = toWalletEvents(txs ?? []);
  const shownActivity = events.slice(0, 4);
  const moreActivity = events.length > 4;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* 1 · compact header row in the gutter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 22px 4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <VeraOrb size={40} />
          <div>
            <div className="caption" style={{ fontWeight: 500 }}>Hey there 👋</div>
            <h1 className="serif" style={{ margin: 0, fontSize: 25, letterSpacing: "-.01em" }}>Your money</h1>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {tok && (
            <button
              onClick={() => go("token")}
              className="tap tnum"
              aria-label="$MONVERA price"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                height: 26,
                padding: "0 9px",
                borderRadius: 999,
                background: "var(--surface-2)",
                fontSize: 10.5,
                fontWeight: 600,
                lineHeight: 1,
                whiteSpace: "nowrap",
                color: "var(--ink)",
              }}
            >
              <span>$MONVERA</span>
              <span style={{ color: tok.change24h >= 0 ? "var(--pos)" : "var(--neg)" }}>
                {tok.change24h >= 0 ? "▲" : "▼"}
                {Math.abs(tok.change24h).toFixed(1)}%
              </span>
            </button>
          )}
          <button onClick={() => go("wallet")} style={iconBtn} className="tap" aria-label="Wallet">
            <Icon name="wallet" size={21} />
          </button>
          <button onClick={() => go("notifications")} style={{ ...iconBtn, position: "relative" }} className="tap" aria-label="Notifications">
            <Icon name="bell" size={21} />
            {unread > 0 && (
              <span
                style={{ position: "absolute", top: 9, right: 10, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 99, background: "var(--primary)", color: "var(--primary-ink)", fontSize: 9.5, fontWeight: 600, display: "grid", placeItems: "center", lineHeight: 1 }}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button onClick={() => go("settings")} style={iconBtn} className="tap" aria-label="Settings">
            <Icon name="settings" size={21} />
          </button>
        </div>
      </div>

      {/* 2 · balance block — centered focal hero, flat */}
      <div className="anim-rise" style={{ padding: "18px 22px 16px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div className="label-eyebrow">Total balance</div>
          <button
            onClick={() => setHideBalance((v) => !v)}
            className="tap"
            aria-label={hideBalance ? "Show balance" : "Hide balance"}
            style={{
              width: 44, // ≥44px hit target; negative margins keep the label row tight
              height: 44,
              margin: "-9px -4px",
              display: "grid",
              placeItems: "center",
              color: hideBalance ? "var(--primary)" : "var(--ink-3)",
              transition: "color .2s var(--ease-out)",
            }}
          >
            <Icon name="eye" size={16} stroke={hideBalance ? 2.4 : 1.8} />
          </button>
        </div>
        <div style={{ marginTop: 8, minHeight: 48 }}>
          {balanceLoading ? (
            <>
              <div className="skeleton" style={{ width: 180, height: 42, borderRadius: 5, margin: "0 auto" }} />
              <div className="skeleton" style={{ width: 132, height: 14, borderRadius: 4, margin: "8px auto 0" }} />
            </>
          ) : (
            <div
              className="tnum"
              style={{ fontSize: balSize, fontWeight: 600, letterSpacing: "-.04em", lineHeight: 1 }}
            >
              {hideBalance ? (
                <span style={{ letterSpacing: ".06em" }}>{DOTS}</span>
              ) : (
                <CountUp to={total} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3 · quick actions — three tinted boxes in the user's brand color.
          Cash-to-invest lives in the Add cash sub-label. */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 10, padding: "4px 22px 14px" }}>
        <QuickAction
          icon="spark"
          label="Invest"
          sub={hideBalance ? DOTS : `${usd(invested)} invested`}
          loading={balanceLoading}
          onClick={() => go("goal")}
        />
        <QuickAction
          icon="wallet"
          label="Add cash"
          sub={hideBalance ? DOTS : `${usd(balance)} cash`}
          loading={balanceLoading}
          onClick={() => go("wallet")}
        />
        {/* Market lives in the bottom nav already — this slot surfaces Autopilot,
            which is otherwise buried in Settings / the Vera screen. */}
        <QuickAction icon="clock" label="Autopilot" sub="Invest on repeat" onClick={() => go("autopilot")} />
      </div>

      {/* 3b · slim secondary actions — span the same width as the cards above. */}
      <div style={{ display: "flex", gap: 10, padding: "0 22px 16px" }}>
        <SlimAction icon="receipt" label="Activity" onClick={() => go("activity")} />
        <SlimAction icon="star" label="Watchlist" onClick={() => go("market", { filter: "watchlist" })} />
        <SlimAction icon="grid" label="Discover" onClick={() => go("discover")} />
      </div>

      {/* Today's movers — biggest market moves across the universe */}
      <MoversStrip go={go} />

      {/* 4 · holdings ledger — compact overview (max 5); Portfolio owns the depth. */}
      {portLoading && <SkeletonLedger rows={3} tile={40} />}
      {holdings.length > 0 && (
        <section style={{ padding: "22px 22px 0" }}>
          {/* One outer box holding the section; each row is a mini box inside. */}
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Your holdings</div>
            <div className="stagger-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shownHoldings.map((h) => {
              const tile = toTile(h.asset.symbol, h.asset.name);
              const day = h.dayChangePct;
              // Plain holdings line ("1.13 sUSDe") — no visible math; the price
              // and value live on the asset page.
              const qtyLine = `${tokenQty(h.raw, h.asset.decimals ?? 18)} ${h.asset.symbol}`;
              return (
                <button
                  key={h.asset.symbol}
                  className="tap"
                  onClick={() => go("asset", { symbol: h.asset.symbol })}
                  style={{ ...innerBox }}
                >
                  <AssetTile asset={tile} size={38} radius={12} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 15.5, letterSpacing: "-.01em" }}>
                      {tile.name}
                    </div>
                    <div
                      className="tnum"
                      style={{
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {hideBalance ? catFor(h.asset.symbol, h.asset.name) : qtyLine}
                    </div>
                  </div>
                  <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
                    <Sparkline
                      data={h.spark ?? tile.spark}
                      color={(day ?? tile.day) >= 0 ? "var(--pos)" : "var(--neg)"}
                    />
                  </div>
                  <div className="tnum" style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 500, fontSize: 15 }}>
                      {hideBalance
                        ? DOTS
                        : h.valueUsd !== undefined
                          ? usd(h.valueUsd)
                          : tokenQty(h.raw, h.asset.decimals ?? 18)}
                    </div>
                    {day !== undefined && (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          marginTop: 2,
                          color: day >= 0 ? "var(--pos)" : "var(--neg)",
                        }}
                      >
                        {(day >= 0 ? "+" : "") + day.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            </div>
            <button
              className="tap"
              onClick={() => go("portfolio")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", padding: "12px 0 4px", background: "none" }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--primary)" }}>
                View all holdings
              </span>
              <Icon name="chevR" size={16} style={{ color: "var(--primary)" }} />
            </button>
          </div>
        </section>
      )}

      {/* Watchlist — the stocks you star (renders only when non-empty) */}
      <WatchlistCard go={go} />

      {/* 6 · Vera invite — flat panel, owns the empty state when nothing is held.
          Focal empty state: orb + copy centered, rises in. */}
      {!portLoading && holdings.length === 0 && (
        <div className="anim-rise" style={{ padding: "28px 22px 0" }}>
          <button
            onClick={() => go("goal")}
            className="card tap"
            style={{
              width: "100%",
              textAlign: "center",
              padding: "26px 18px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <VeraOrb size={44} />
            <div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                Invest with Vera
                <Icon name="arrowUR" size={17} stroke={2.2} style={{ color: "var(--ink-2)" }} />
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
                Tell me a goal, and I&apos;ll build the plan.
              </div>
            </div>
          </button>
        </div>
      )}

      {/* 5 · recent activity — REAL money movement (buy / sell / send / receive) */}
      {activityLoading && shownActivity.length === 0 && <SkeletonLedger rows={3} tile={40} />}
      {shownActivity.length > 0 && (
        <section style={{ padding: "22px 22px 0" }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ ...boxHead }}>Recent activity</div>
            <div className="stagger-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shownActivity.map((e, i) => {
              const { positive } = eventLabel(e);
              const isTrade = e.kind === "buy" || e.kind === "sell";
              const right = `${positive ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
              // Both legs of a trade: money side + asset side.
              const usdgLeg = `${e.kind === "buy" ? "−" : "+"}${usd(e.usdgAmount ?? 0)}`;
              const assetLeg = `${e.kind === "buy" ? "+" : "−"}${fmtAmt(e.amount)} ${e.symbol}`;
              const sub = isTrade ? "Swap" : `${e.symbol}`;
              return (
                <button
                  key={`${e.hash}-${i}`}
                  className="tap"
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
                  style={{ ...innerBox }}
                >
                  <ActivityGlyph event={e} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14.5 }}>{eventLabel(e).verb} {e.symbol}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                      {sub}
                    </div>
                  </div>
                  {isTrade ? (
                    <div className="tnum" style={{ textAlign: "right", flex: "none" }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: e.kind === "sell" ? "var(--pos)" : "var(--ink)" }}>
                        {hideBalance ? DOTS : usdgLeg}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, marginTop: 1, color: e.kind === "buy" ? "var(--pos)" : "var(--ink-2)" }}>
                        {hideBalance ? DOTS : assetLeg}
                      </div>
                    </div>
                  ) : (
                    <span
                      className="tnum"
                      style={{ fontWeight: 600, fontSize: 15, color: positive ? "var(--pos)" : "var(--ink)" }}
                    >
                      {hideBalance ? DOTS : right}
                    </span>
                  )}
                </button>
              );
            })}
            </div>
            {moreActivity && (
              <button
                className="tap"
                onClick={() => go("activity")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", padding: "12px 0 4px", background: "none" }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--primary)" }}>
                  View all activity
                </span>
                <Icon name="chevR" size={16} style={{ color: "var(--primary)" }} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* trust footer — centered standalone badge */}
      <div style={{ padding: "24px 22px 0", display: "flex", justifyContent: "center" }}>
        <VerifiedBadge label="Every plan signed & recorded by Vera" onClick={() => go("vera")} />
      </div>
    </div>
  );
}
