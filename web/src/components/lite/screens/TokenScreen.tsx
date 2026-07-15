"use client";

// $MONVERA — the in-app token page. Live price + DexScreener chart, the real
// stats (mkt cap / liquidity / 24h volume), the 100k holder gate toward Scan to
// Buy, and gasless buy / drip-bootstrapped sell over the Uniswap v2 route (see
// useMonveraSwap). Below the fold: the six content tabs (synced from the
// Virtuals profile kit) and the honest "token, not the product" footer.
//
// $MONVERA is a sub-cent token, so prices show three significant figures rather
// than the 2dp usd() the equities screens use. Layout mirrors the sibling
// screens: back-button header, inline styles with CSS vars, primitives.
import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useMonveraPrice, useMonveraGate, useMonveraChart, type TokenChartRange } from "@/hooks/useMonveraToken";
import { useMonveraSwap } from "@/hooks/useMonveraSwap";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useUsdcBalance } from "@/hooks/useBalances";
import { TOKEN_TABS } from "@/lib/tokenContent";
import { MONVERA, MONVERA_LINKS, HOLDER_THRESHOLD } from "@/lib/monveraToken";
import { EXPLORER_URL } from "@/lib/chain";
import { Icon, PriceChart, useToast } from "@/components/design";
import { haptic } from "@/lib/haptics";
import { shortAddress } from "@/lib/format";
import { iconBtn, Spinner } from "./primitives";

// Three significant figures — the token trades well under a cent, so 2dp would
// collapse to "$0.00". toPrecision keeps the meaningful digits (0.000941).
function fmtPrice(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 1) return `$${Number(n.toPrecision(3))}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact dollar stat: 125340 -> "$125.3K", 1_240_000 -> "$1.24M".
function fmtCompactUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// A raw 18dp token amount as a friendly count (no long decimal tails).
function fmtTokenAmount(raw: bigint, decimals = 18): string {
  const n = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// Sanitize a numeric text input: digits + a single decimal point only.
const cleanNum = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

const HOLDER_WHOLE = Number(HOLDER_THRESHOLD / BigInt(10) ** BigInt(18)); // 100000

export function TokenScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { notify } = useToast();
  const { address } = useSmartAccount();
  const { data: tok } = useMonveraPrice();
  const gate = useMonveraGate(address ?? undefined);
  const { data: cash } = useUsdcBalance(address ?? undefined);
  const swap = useMonveraSwap();
  const { quoteOut, buy, sell, reset, phase, error, result, busy } = swap;

  const [tab, setTab] = useState(TOKEN_TABS[0].id);
  const activeTab = TOKEN_TABS.find((t) => t.id === tab) ?? TOKEN_TABS[0];

  // A finished swap gets its own full-page receipt (TokenSwapSuccessScreen);
  // this screen unmounts on push and comes back with a clean panel on pop.
  useEffect(() => {
    if (phase === "done" && result) go("tokendone", { result });
  }, [phase, result, go]);

  const copyCA = async () => {
    try {
      await navigator.clipboard.writeText(MONVERA.address);
      haptic.light();
      notify("Address copied", "check");
    } catch {
      /* clipboard blocked — nothing to recover, the pill just no-ops */
    }
  };

  const up = (tok?.change24h ?? 0) >= 0;

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header — back + title + copy-CA pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 600, letterSpacing: "-.02em" }}>
          $MONVERA
        </h1>
        <button
          onClick={copyCA}
          className="tap"
          aria-label="Copy contract address"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flex: "none",
            height: 34,
            padding: "0 12px",
            borderRadius: 999,
            background: "var(--surface-2)",
            color: "var(--ink-2)",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          <span className="mono">{shortAddress(MONVERA.address)}</span>
          <Icon name="link" size={14} />
        </button>
      </div>

      {/* price hero — big sub-cent number + 24h chip */}
      <div className="anim-rise" style={{ padding: "16px 22px 0", textAlign: "center" }}>
        <div className="tnum" style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-.02em" }}>
          {tok ? fmtPrice(tok.priceUsd) : "—"}
        </div>
        {tok && (
          <div
            className="tnum"
            style={{
              display: "inline-block",
              marginTop: 6,
              fontSize: 13.5,
              fontWeight: 600,
              color: up ? "var(--pos)" : "var(--neg)",
            }}
          >
            {up ? "▲" : "▼"} {Math.abs(tok.change24h).toFixed(2)}%{" "}
            <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>· 24h</span>
          </div>
        )}
      </div>

      {/* chart — the app's native PriceChart, fed by GeckoTerminal OHLCV */}
      <MonveraChart />

      {/* buy / sell — trading first; stats + the holder gate sit below it */}
      <SwapPanel
        swap={{ quoteOut, buy, sell, reset, phase, error, result, busy }}
        usdgBalance={cash?.value ?? 0}
        balance={gate.balance}
      />

      {/* stats — market cap · liquidity · 24h volume */}
      <div style={{ display: "flex", gap: 10, padding: "22px 22px 0" }}>
        <StatCell label="Market cap" value={fmtCompactUsd(tok?.marketCap)} />
        <StatCell label="Liquidity" value={fmtCompactUsd(tok?.liquidityUsd)} />
        <StatCell label="24h volume" value={fmtCompactUsd(tok?.volume24h)} />
      </div>

      {/* holder gate — progress toward Scan to Buy (+ the wallet's holding in USDG) */}
      <HolderCard gate={gate} priceUsd={tok?.priceUsd} />

      {/* links */}
      <div style={{ display: "flex", gap: 10, padding: "22px 22px 0" }}>
        <LinkPill href={MONVERA_LINKS.virtuals} label="Virtuals" />
        <LinkPill href={MONVERA_LINKS.dexscreener} label="DexScreener" />
        <LinkPill href={MONVERA_LINKS.blockscoutToken} label="Blockscout" />
      </div>

      {/* content tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "26px 22px 0",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {TOKEN_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              haptic.select();
              setTab(t.id);
            }}
            className={`chip tap ${tab === t.id ? "is-dark" : ""}`}
            aria-pressed={tab === t.id}
            style={{ flex: "none", height: 34, fontSize: 13, fontWeight: 500 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* One card per content section: heading, body, bullet rows, link pills, mono CA. */}
      <div
        key={activeTab.id}
        className="anim-rise"
        style={{ padding: "16px 22px 0", display: "flex", flexDirection: "column", gap: 10 }}
      >
        {activeTab.sections.map((s, i) => (
          <div
            key={i}
            style={{
              background: "var(--surface)",
              borderRadius: "var(--rr)",
              boxShadow: "var(--shadow)",
              padding: "14px 16px",
            }}
          >
            {s.heading &&
              (activeTab.id === "qa" ? (
                <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>
                  {s.heading}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                  }}
                >
                  {s.heading}
                </div>
              ))}
            {s.body && (
              <p
                style={{
                  margin: s.heading ? "7px 0 0" : 0,
                  fontSize: 14,
                  lineHeight: 1.62,
                  color: "var(--ink-2)",
                }}
              >
                {s.body}
              </p>
            )}
            {s.bullets && s.bullets.length > 0 && (
              <div style={{ marginTop: s.heading || s.body ? 10 : 0 }}>
                {s.bullets.map((b, j) => (
                  <div
                    key={j}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "9px 0",
                      borderTop: j > 0 ? "1px solid var(--line-2)" : "none",
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        width: 5,
                        height: 5,
                        borderRadius: 999,
                        background: "var(--primary)",
                        marginTop: 8,
                      }}
                    />
                    <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-2)" }}>{b}</span>
                  </div>
                ))}
              </div>
            )}
            {s.links && s.links.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: s.heading || s.body ? 12 : 0 }}>
                {s.links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tap"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "7px 12px",
                      borderRadius: 999,
                      background: "var(--surface-2)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink)",
                      textDecoration: "none",
                    }}
                  >
                    {l.label}
                    <Icon name="arrowUR" size={12} style={{ color: "var(--ink-3)" }} />
                  </a>
                ))}
              </div>
            )}
            {s.mono && (
              <div
                className="mono tnum"
                style={{
                  marginTop: 10,
                  padding: "9px 12px",
                  borderRadius: 12,
                  background: "var(--surface-2)",
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  wordBreak: "break-all",
                  lineHeight: 1.5,
                }}
              >
                {s.mono}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* footer disclaimer */}
      <p
        style={{
          margin: "28px 22px 0",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--ink-3)",
          textAlign: "center",
        }}
      >
        $MONVERA is the project token, not the product. Not investment advice.
      </p>
    </div>
  );
}

// $MONVERA chart — the app's native scrubbable PriceChart with range chips,
// same treatment as a stock's detail chart. Data is real pool OHLCV.
const CHART_RANGES: TokenChartRange[] = ["5m", "1h", "4h", "1d", "7d"];

function MonveraChart() {
  const [range, setRange] = useState<TokenChartRange>("1h");
  const { data: chart, isLoading } = useMonveraChart(range);
  const series = chart?.series ?? [];
  const up = (chart?.changePct ?? 0) >= 0;

  return (
    <div className="anim-rise" style={{ animationDelay: ".05s", padding: "8px 22px 0" }}>
      <div style={{ minHeight: 210 }}>
        {series.length > 1 ? (
          <PriceChart
            data={series}
            up={up}
            height={210}
            raw
            label={`$MONVERA price chart, ${up ? "up" : "down"} ${Math.abs(chart?.changePct ?? 0).toFixed(1)}% over ${range}. Touch and drag to read the price at any point.`}
          />
        ) : (
          <div style={{ height: 210, display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 }}>
            {isLoading ? <Spinner /> : "Chart data isn't available yet."}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
        {CHART_RANGES.map((r) => (
          <button
            key={r}
            className={`chip tap ${range === r ? "is-on" : ""}`}
            onClick={() => {
              haptic.select();
              setRange(r);
            }}
            style={{ height: 30, fontSize: 12.5, fontWeight: 600, minWidth: 44 }}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

// One stat in the market-cap / liquidity / volume row.
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--surface)",
        borderRadius: "var(--rr)",
        boxShadow: "var(--shadow)",
        padding: "12px 12px",
        textAlign: "center",
      }}
    >
      <div className="tnum" style={{ fontSize: 15.5, fontWeight: 600, color: "var(--ink)" }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// Holder gate — a met badge, or a progress bar toward the 100k unlock. Also the
// home of "what my $MONVERA is worth": tokens held valued live in USDG.
function HolderCard({ gate, priceUsd }: { gate: ReturnType<typeof useMonveraGate>; priceUsd?: number }) {
  const held = Number(gate.balance / BigInt(10) ** BigInt(18));
  const heldUsd = priceUsd ? Number(formatUnits(gate.balance, 18)) * priceUsd : null;
  return (
    <div
      style={{
        margin: "16px 22px 0",
        background: "var(--surface)",
        borderRadius: "var(--rr)",
        boxShadow: "var(--shadow)",
        padding: "16px",
      }}
    >
      {held > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            paddingBottom: 12,
            marginBottom: 12,
            borderBottom: "1px solid var(--line-2)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>You hold</span>
          <span className="tnum" style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            {held.toLocaleString("en-US")} $MONVERA
            {heldUsd != null && (
              <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>
                {" "}
                ≈ {heldUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDG
              </span>
            )}
          </span>
        </div>
      )}
      {gate.isHolder ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            <Icon name="check" size={18} />
          </span>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>
            Holder ✓{" "}
            <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>— Scan to Buy unlocks soon</span>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>Scan to Buy</span>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {held.toLocaleString("en-US")} / {HOLDER_WHOLE.toLocaleString("en-US")} $MONVERA
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.round(gate.progress * 100)}%`,
                height: "100%",
                borderRadius: 999,
                background: "var(--primary)",
                transition: "width .4s var(--ease-soft)",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
            Hold 100,000 $MONVERA to unlock Scan to Buy — photograph any product and Vera invests in
            the companies behind it.
          </div>
        </>
      )}
    </div>
  );
}

// A pill in the external-links row.
function LinkPill({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="tap"
      style={{
        flex: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 40,
        borderRadius: "var(--rr)",
        background: "var(--surface-2)",
        color: "var(--ink)",
        fontSize: 13,
        fontWeight: 500,
        textDecoration: "none",
      }}
    >
      {label}
      <Icon name="arrowUR" size={14} style={{ color: "var(--ink-3)" }} />
    </a>
  );
}

type SwapApi = Pick<
  ReturnType<typeof useMonveraSwap>,
  "quoteOut" | "buy" | "sell" | "reset" | "phase" | "error" | "result" | "busy"
>;

// Buy (dollars in) / Sell (MONVERA in) with a debounced live preview. Buys are
// fully gasless; the first sell shows a brief "Preparing your wallet…" while the
// one-time approve is bootstrapped by the gas drip (see useMonveraSwap).
function SwapPanel({
  swap,
  balance,
  usdgBalance,
}: {
  swap: SwapApi;
  balance: bigint;
  /** Spendable USDG in the wallet (dollars) — sizes the buy chips. */
  usdgBalance: number;
}) {
  const { quoteOut, buy, sell, reset, phase, error, result, busy } = swap;
  const [side, setSide] = useState<"buy" | "sell">("buy");

  // Buy: dollars typed -> expected MONVERA out (raw 18dp).
  const [buyAmt, setBuyAmt] = useState("");
  const [buyOut, setBuyOut] = useState<bigint | null>(null);
  // Sell: MONVERA typed (or MAX) -> expected USDG out (raw 6dp).
  const [sellAmt, setSellAmt] = useState("");
  const [sellIsMax, setSellIsMax] = useState(false);
  const [sellOut, setSellOut] = useState<bigint | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const buyUsd = parseFloat(buyAmt) || 0;
  const sellRaw = (() => {
    if (sellIsMax) return balance;
    if (!(parseFloat(sellAmt) > 0)) return BigInt(0);
    try {
      return parseUnits(sellAmt, 18);
    } catch {
      return BigInt(0);
    }
  })();

  // Debounced buy preview — quote 400ms after typing settles, race-guarded.
  useEffect(() => {
    if (side !== "buy") return;
    if (!(buyUsd > 0)) {
      setBuyOut(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const out = await quoteOut("buy", BigInt(Math.round(buyUsd * 1_000_000)));
        if (!cancelled) setBuyOut(out > BigInt(0) ? out : null);
      } catch {
        if (!cancelled) setBuyOut(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [side, buyUsd, quoteOut]);

  // Debounced sell preview.
  const sellKey = sellRaw.toString();
  useEffect(() => {
    if (side !== "sell") return;
    if (sellRaw <= BigInt(0)) {
      setSellOut(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const out = await quoteOut("sell", sellRaw);
        if (!cancelled) setSellOut(out > BigInt(0) ? out : null);
      } catch {
        if (!cancelled) setSellOut(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, sellKey, quoteOut]);

  // A finished swap navigates to the full-page receipt (see TokenScreen's
  // effect) — render nothing for the single frame before the push lands.
  if (phase === "done") return null;

  const canSubmit = side === "buy" ? buyUsd > 0 : sellRaw > BigInt(0);
  const label = busy
    ? phase === "preparing"
      ? "Preparing your wallet…"
      : phase === "quoting"
        ? "Getting a price…"
        : side === "buy"
          ? "Buying…"
          : "Selling…"
    : side === "buy"
      ? "Buy $MONVERA"
      : "Sell $MONVERA";

  return (
    <div style={{ padding: "20px 22px 0" }}>
      {/* buy / sell segmented control */}
      <div className="seg">
        <span
          className="seg-thumb"
          style={{
            width: "calc((100% - 8px) / 2)",
            left: 4,
            transform: `translateX(${side === "sell" ? "100%" : "0"})`,
          }}
        />
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              haptic.select();
              setSide(s);
              if (error) reset();
            }}
            className={`seg-item ${side === s ? "is-on" : ""}`}
            style={{ textTransform: "capitalize" }}
          >
            {s}
          </button>
        ))}
      </div>

      {side === "buy" ? (
        <>
          {/* dollar amount in */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", marginTop: 22 }}>
            <span
              className="tnum"
              style={{ fontSize: 44, fontWeight: 600, color: buyAmt ? "var(--ink)" : "var(--ink-3)" }}
            >
              $
            </span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={buyAmt}
              onChange={(e) => {
                setBuyAmt(cleanNum(e.target.value));
                if (error) reset();
              }}
              aria-label="Amount to buy in dollars"
              className="tnum"
              style={{
                fontSize: 44,
                fontWeight: 600,
                color: buyAmt ? "var(--ink)" : "var(--ink-3)",
                border: "none",
                background: "transparent",
                outline: "none",
                padding: 0,
                textAlign: "left",
                width: `${Math.max(1, (buyAmt || "0").length)}ch`,
                caretColor: "var(--primary)",
              }}
            />
          </div>
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
            <span className="tnum">
              {usdgBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDG
              available
            </span>
          </div>
          {/* quick-size chips — fractions of the spendable USDG balance */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
            {([25, 50, 75] as const).map((pct) => (
              <button
                key={pct}
                className="chip tap"
                onClick={() => {
                  haptic.select();
                  setBuyAmt(((usdgBalance * pct) / 100).toFixed(2));
                  if (error) reset();
                }}
                style={{ height: 28, fontSize: 12, fontWeight: 600 }}
                disabled={usdgBalance <= 0}
              >
                {pct}%
              </button>
            ))}
            <button
              className="chip tap"
              onClick={() => {
                haptic.select();
                setBuyAmt(usdgBalance.toFixed(2));
                if (error) reset();
              }}
              style={{ height: 28, fontSize: 12, fontWeight: 600 }}
              disabled={usdgBalance <= 0}
            >
              Max
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 13.5, color: "var(--ink-2)", minHeight: 18 }}>
            {previewing && !buyOut
              ? "Getting a price…"
              : buyOut
                ? `You receive ≈ ${fmtTokenAmount(buyOut)} MONVERA`
                : ""}
          </div>
        </>
      ) : (
        <>
          {/* MONVERA amount in + MAX */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", marginTop: 22, gap: 8 }}>
            <input
              inputMode="decimal"
              placeholder="0"
              value={sellAmt}
              onChange={(e) => {
                setSellAmt(cleanNum(e.target.value));
                setSellIsMax(false);
                if (error) reset();
              }}
              aria-label="Amount of MONVERA to sell"
              className="tnum"
              style={{
                fontSize: 40,
                fontWeight: 600,
                color: sellAmt ? "var(--ink)" : "var(--ink-3)",
                border: "none",
                background: "transparent",
                outline: "none",
                padding: 0,
                textAlign: "center",
                maxWidth: "70%",
                width: `${Math.max(1, (sellAmt || "0").length)}ch`,
                caretColor: "var(--primary)",
              }}
            />
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-3)" }}>MONVERA</span>
          </div>
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
            <span className="tnum">You hold {fmtTokenAmount(balance)}</span>
          </div>
          {/* quick-size chips — 25/50/75% round down to whole tokens; Max sells the exact raw balance */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
            {([25, 50, 75] as const).map((pct) => (
              <button
                key={pct}
                className="chip tap"
                onClick={() => {
                  haptic.select();
                  setSellIsMax(false);
                  setSellAmt(formatUnits((balance * BigInt(pct)) / BigInt(100), 18));
                  if (error) reset();
                }}
                style={{ height: 28, fontSize: 12, fontWeight: 600 }}
                disabled={balance <= BigInt(0)}
              >
                {pct}%
              </button>
            ))}
            <button
              className="chip tap"
              onClick={() => {
                haptic.select();
                setSellIsMax(true);
                setSellAmt(formatUnits(balance, 18));
                if (error) reset();
              }}
              style={{ height: 28, fontSize: 12, fontWeight: 600 }}
              disabled={balance <= BigInt(0)}
            >
              Max
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 13.5, color: "var(--ink-2)", minHeight: 18 }}>
            {previewing && !sellOut
              ? "Getting a price…"
              : sellOut
                ? `You receive ≈ $${Number(formatUnits(sellOut, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : ""}
          </div>
        </>
      )}

      {error && (
        <div
          onClick={reset}
          className="tap"
          style={{
            margin: "14px 0 0",
            background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
            color: "var(--neg)",
            padding: "11px 14px",
            borderRadius: "var(--rr)",
            fontSize: 13.5,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      <button
        className="btn btn-primary btn-block btn-lg tap"
        style={{ marginTop: 16 }}
        disabled={busy || !canSubmit}
        onClick={() => {
          haptic.medium();
          if (side === "buy") void buy(buyUsd);
          else void sell(sellRaw);
        }}
      >
        {busy ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
            <Spinner small /> {label}
          </span>
        ) : (
          label
        )}
      </button>
      <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "var(--ink-3)" }}>
        Swaps are powered by Li.Fi
      </div>
    </div>
  );
}
