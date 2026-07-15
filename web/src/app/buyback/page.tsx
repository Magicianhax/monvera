"use client";

// Public $MONVERA buyback transparency dashboard (monvera.best/buyback).
// Reads /api/buyback: live treasury revenue, the 20%-of-net buyback budget, total
// bought back, average price, expenses, and the on-chain buyback log. Self-styled
// (dark, brand-green) so it stands on its own outside the app shell.
import { useEffect, useState, type CSSProperties } from "react";

const TREASURY = "0xb87f5A74267ca3F9512b8511B32cCd804EA3707E";
const MONVERA_CA = "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF";
const POOL = "0x502Be3da0Ad1c83C79A9e64Ac5A05eEc39A44c78";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const DEXSCREENER_EMBED = `https://dexscreener.com/robinhood/${POOL}?embed=1&theme=dark&info=0&trades=0`;

interface Buyback { txHash: string; blockNumber: number; boughtAt: number; monveraAmount: number; usdgSpent: number; priceUsd: number; }
interface Expense { id: number; spentAt: number; description: string; amountUsd: number; }
interface Stats {
  treasury: string; treasuryUsdg: number; treasuryMonvera: number;
  totalRevenue: number; totalExpenses: number; netRevenue: number;
  buybackPct: number; buybackBudget: number;
  totalBought: number; totalSpent: number; avgPrice: number | null;
  availableToBuy: number; budgetDeployedPct: number; buybackCount: number; asOf: string;
}
interface Data { stats: Stats; buybacks: Buyback[]; expenses: Expense[]; }

const usd = (n: number, dp = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const num = (n: number, dp = 0) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const priceStr = (p: number) => (p < 0.01 ? `$${Number(p.toPrecision(3))}` : usd(p, 4));
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
function when(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const C = {
  bg: "#0d1210", surface: "#141b18", surface2: "#1a2320", line: "#26302c",
  ink: "#e9efec", ink2: "#9fb0a8", ink3: "#6c7d76", green: "#43ba85", greenSoft: "rgba(67,186,133,.12)", neg: "#e5484d",
};

const card: CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 };
const label: CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: C.ink3 };

function Metric({ l, value, sub, accent }: { l: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ ...card, padding: "18px 20px", flex: "1 1 200px", minWidth: 0 }}>
      <div style={label}>{l}</div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", marginTop: 6, color: accent ? C.green : C.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: C.ink2, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function BuybackPage() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/buyback")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: Data) => alive && setData(d))
        .catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const s = data?.stats;

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 72px" }}>
        {/* header */}
        <header style={{ marginBottom: 28 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: C.green, background: C.greenSoft, padding: "4px 11px", borderRadius: 999 }}>
            $MONVERA buyback
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-.02em", margin: "14px 0 8px" }}>Buyback transparency</h1>
          <p style={{ fontSize: 15, color: C.ink2, margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
            A share of Monvera&apos;s trading revenue buys back $MONVERA on-chain. After expenses, <strong style={{ color: C.ink }}>20% of net revenue</strong>{" "}
            is allocated to buybacks — a rate that is <strong style={{ color: C.ink }}>dynamic</strong>, flexing with the agent&apos;s running costs. Every figure
            here is read live from the treasury on Robinhood Chain — nothing is self-reported.
          </p>
          <div style={{ marginTop: 12, fontSize: 13, color: C.ink3 }}>
            Treasury:{" "}
            <a href={`${EXPLORER}/address/${TREASURY}`} target="_blank" rel="noreferrer" style={{ color: C.ink2, fontFamily: "ui-monospace, monospace" }}>{short(TREASURY)}</a>
            {s && <> · updated {new Date(s.asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</>}
          </div>
        </header>

        {err && !data && <div style={{ ...card, padding: 20, color: C.ink2 }}>Couldn&apos;t load buyback data. Refresh in a moment.</div>}

        {s && (
          <>
            {/* hero metrics */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              <Metric l="Treasury revenue" value={usd(s.totalRevenue)} sub="USDG collected from trading" />
              <Metric l="Allocated for buyback (20%, dynamic)" value={usd(s.buybackBudget)} sub={`of ${usd(s.netRevenue)} net revenue`} accent />
              <Metric l="Bought back" value={`${num(s.totalBought)} `} sub={`$MONVERA · ${usd(s.totalSpent)} spent`} />
              <Metric l="Avg buy price" value={s.avgPrice ? priceStr(s.avgPrice) : "—"} sub={s.avgPrice ? "across all buybacks" : "no buys yet"} />
            </div>

            {/* budget progress */}
            <div style={{ ...card, padding: "18px 20px", marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={label}>Buyback budget deployed</div>
                <div style={{ fontSize: 13, color: C.ink2 }}>
                  {usd(s.totalSpent)} spent · <strong style={{ color: C.green }}>{usd(s.availableToBuy)} queued to buy</strong>
                </div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: C.surface2, marginTop: 12, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${s.budgetDeployedPct}%`, background: C.green, borderRadius: 999, transition: "width .4s ease" }} />
              </div>
              <div style={{ display: "flex", gap: 22, marginTop: 14, flexWrap: "wrap", fontSize: 13 }}>
                <span style={{ color: C.ink3 }}>Net revenue <strong style={{ color: C.ink }}>{usd(s.netRevenue)}</strong></span>
                <span style={{ color: C.ink3 }}>Expenses <strong style={{ color: C.ink }}>{usd(s.totalExpenses)}</strong></span>
                <span style={{ color: C.ink3 }}>Treasury holds <strong style={{ color: C.ink }}>{num(s.treasuryMonvera)} $MONVERA</strong></span>
              </div>
            </div>

            {/* chart */}
            <section style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 12px" }}>$MONVERA market</h2>
              <div style={{ ...card, overflow: "hidden", height: 460 }}>
                <iframe title="DexScreener $MONVERA chart" src={DEXSCREENER_EMBED} style={{ width: "100%", height: "100%", border: 0 }} />
              </div>
              <p style={{ fontSize: 12.5, color: C.ink3, marginTop: 8 }}>Each buyback below is executed against this pool and recorded on-chain.</p>
            </section>

            {/* buybacks table */}
            <section style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 12px" }}>Buybacks {s.buybackCount > 0 && <span style={{ color: C.ink3, fontWeight: 500 }}>({s.buybackCount})</span>}</h2>
              <div style={{ ...card, overflow: "hidden" }}>
                {data!.buybacks.length === 0 ? (
                  <div style={{ padding: "34px 20px", textAlign: "center", color: C.ink2, fontSize: 14 }}>
                    No buybacks yet. {usd(s.availableToBuy)} of net revenue is queued for the first buy; each one will appear here with its price and on-chain receipt.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                      <thead>
                        <tr>
                          {["Time", "$MONVERA bought", "Spent", "Price", "Tx"].map((h, i) => (
                            <th key={h} style={{ textAlign: i === 0 || i === 4 ? "left" : "right", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: C.ink3, padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data!.buybacks.map((b) => (
                          <tr key={b.txHash}>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.surface2}`, color: C.ink2, fontSize: 13.5 }}>{when(b.boughtAt)}</td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.surface2}`, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{num(b.monveraAmount)}</td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.surface2}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(b.usdgSpent)}</td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.surface2}`, textAlign: "right", color: C.green, fontVariantNumeric: "tabular-nums" }}>{priceStr(b.priceUsd)}</td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.surface2}` }}>
                              <a href={`${EXPLORER}/tx/${b.txHash}`} target="_blank" rel="noreferrer" style={{ color: C.ink2, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{short(b.txHash)}</a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* expenses */}
            <section style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 12px" }}>Expenses <span style={{ color: C.ink3, fontWeight: 500 }}>(deducted before the 20%)</span></h2>
              <div style={{ ...card, overflow: "hidden" }}>
                {data!.expenses.map((e, i) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: i < data!.expenses.length - 1 ? `1px solid ${C.surface2}` : "none" }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14.5 }}>{e.description}</div>
                      <div style={{ fontSize: 12.5, color: C.ink3, marginTop: 2 }}>{when(e.spentAt)}</div>
                    </div>
                    <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: e.amountUsd > 0 ? C.ink : C.green }}>{e.amountUsd > 0 ? usd(e.amountUsd) : "Covered"}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* FAQ */}
            <section style={{ marginTop: 28 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 12px" }}>FAQ</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  {
                    q: "How much of revenue goes to buybacks?",
                    a: (
                      <>
                        20% of net revenue (revenue after expenses). The rate is <strong style={{ color: C.ink }}>dynamic</strong> — it flexes with the agent&apos;s
                        running costs and will adjust as new revenue streams are added. Today, revenue comes from Monvera&apos;s trading fees.
                      </>
                    ),
                  },
                  {
                    q: "What are the running costs?",
                    a: (
                      <>
                        The agent&apos;s single largest cost is AI inference, and it is currently <strong style={{ color: C.ink }}>covered by Virtuals</strong> through
                        weekly inference credits (~$1,000/week), so it is not deducted from revenue for now (
                        <a href="https://x.com/buildonvirtuals/status/2076732768613224605" target="_blank" rel="noreferrer" style={{ color: C.green }}>source</a>). Other
                        expenses, such as the $299 DexScreener verification fee, are deducted before the 20% is calculated.
                      </>
                    ),
                  },
                  {
                    q: "What happens to the tokens bought back?",
                    a: <>They are held in the treasury and directed back to the community as rewards for using Monvera.</>,
                  },
                ].map((f) => (
                  <div key={f.q} style={{ ...card, padding: "16px 18px" }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 6 }}>{f.q}</div>
                    <div style={{ fontSize: 13.5, color: C.ink2, lineHeight: 1.6 }}>{f.a}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* how it works */}
            <footer style={{ marginTop: 32, paddingTop: 20, borderTop: `1px solid ${C.line}`, fontSize: 13, color: C.ink3, lineHeight: 1.65 }}>
              <p style={{ margin: "0 0 8px" }}>
                <strong style={{ color: C.ink2 }}>How it&apos;s calculated:</strong> revenue is the USDG the treasury has collected; expenses are subtracted first;
                20% of the remaining net revenue is the buyback budget. Buying reduces the queued amount, not the budget, so the 20% always tracks net revenue earned. Values update live from chain.
              </p>
              <p style={{ margin: 0 }}>
                Verify: <a href={`${EXPLORER}/address/${TREASURY}`} target="_blank" rel="noreferrer" style={{ color: C.green }}>treasury wallet</a> ·{" "}
                <a href={`${EXPLORER}/token/${MONVERA_CA}`} target="_blank" rel="noreferrer" style={{ color: C.green }}>$MONVERA contract</a>
              </p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
