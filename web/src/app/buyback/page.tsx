import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { ArrowUpRight, ArrowDown, ChevronDown } from "lucide-react";
import { getBuybackData, maybeIndex, TREASURY } from "@/lib/server/buybackStore";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import { BuybackTable } from "./BuybackTable";
import s from "./buyback.module.css";

// Public, world-readable transparency page — moves no money, so not geo-gated.
// Server-rendered from live treasury reads + the D1 buyback log; revalidates each
// minute. Renders honest zeros/empty states rather than inventing numbers.
export const revalidate = 60;

export const metadata: Metadata = pageMeta({
  title: "Buyback transparency",
  description:
    "A share of Monvera's trading revenue buys back $MONVERA on-chain. 20% of net revenue (dynamic) is allocated to buybacks — every figure is read live from the treasury on Robinhood Chain.",
  path: "/buyback",
});

const EXPLORER = "https://robinhoodchain.blockscout.com";
const POOL = "0x502Be3da0Ad1c83C79A9e64Ac5A05eEc39A44c78";
const MONVERA_CA = "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF";
const DEXSCREENER_EMBED = `https://dexscreener.com/robinhood/${POOL}?embed=1&theme=dark&info=0&trades=0`;

const usd = (n: number, dp = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const priceStr = (p: number) => (p < 0.01 ? `$${Number(p.toPrecision(3))}` : usd(p, 4));
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
function when(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

export default async function BuybackPage() {
  try {
    await maybeIndex();
  } catch {
    /* indexing is best-effort */
  }
  const { stats: st, buybacks, expenses } = await getBuybackData();

  return (
    <SiteDocShell
      eyebrow="Buyback"
      title="Buyback transparency"
      lead={
        <>
          A share of Monvera&apos;s trading revenue buys back $MONVERA on-chain. After expenses, <strong>20% of net revenue</strong> — a
          <strong> dynamic</strong> rate that flexes with the agent&apos;s running costs — is allocated to buybacks. Every figure here is read
          live from the treasury, not self-reported.
        </>
      }
    >
      <p className={s.treasury}>
        <span className={s.treasuryLabel}>Treasury wallet</span>
        <a href={`${EXPLORER}/address/${TREASURY}`} target="_blank" rel="noreferrer" className={s.treasuryAddr}>{TREASURY}</a>
      </p>

      {/* metrics */}
      <div className={s.stats}>
        <div className={s.stat}>
          <div className={s.statLabel}>Treasury revenue</div>
          <div className={s.statValue}>{usd(st.totalRevenue)}</div>
          <div className={s.statSub}>from Monvera trading fees</div>
        </div>
        <a href="#expenses" className={`${s.stat} ${s.statLink}`}>
          <div className={s.statLabel}>Expenses</div>
          <div className={s.statValue}>{usd(st.totalExpenses)}</div>
          <div className={s.statSub}>deducted first</div>
          <ArrowDown size={14} strokeWidth={2.2} className={s.statArrow} aria-hidden />
        </a>
        <div className={s.stat}>
          <div className={s.statLabel}>Buyback budget</div>
          <div className={`${s.statValue} ${s.statAccent}`}>{usd(st.buybackBudget)}</div>
          <div className={s.statSub}>20% of net · dynamic</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Bought back</div>
          <div className={s.statValue}>{num(st.totalBought)} <span className={s.statUnit}>$MONVERA</span></div>
          <div className={s.statSub}>{usd(st.totalSpent, 0)} spent</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Supply bought back</div>
          <div className={s.statValue}>{((st.totalBought / 1_000_000_000) * 100).toFixed(2)}%</div>
          <div className={s.statSub}>of 1B total supply</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Avg buy price</div>
          <div className={s.statValue}>{st.avgPrice ? priceStr(st.avgPrice) : "—"}</div>
          <div className={s.statSub}>{st.avgPrice ? "across all buybacks" : "no buys yet"}</div>
        </div>
      </div>

      {/* budget deployed */}
      <div className={s.budget}>
        <div className={s.budgetHead}>
          <span className={s.budgetLabel}>Buyback budget deployed</span>
          <span className={s.budgetNote}>
            {usd(st.totalSpent)} spent · <span className={s.queued}>{usd(st.availableToBuy)} queued to buy</span>
          </span>
        </div>
        <div className={s.track}>
          <div className={s.fill} style={{ width: `${st.budgetDeployedPct}%` }} />
        </div>
        <div className={s.budgetMeta}>
          <span>Net revenue <b>{usd(st.netRevenue)}</b></span>
          <span>Expenses <b>{usd(st.totalExpenses)}</b></span>
          <span>Treasury holds <b>{num(st.treasuryMonvera)} $MONVERA</b></span>
        </div>
      </div>

      {/* buybacks — before the market */}
      <h2 className={s.sectionHead}>
        Buybacks {st.buybackCount > 0 && <span className={s.count}>({st.buybackCount})</span>}
      </h2>
      {buybacks.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyNote}>
            No buybacks yet. {usd(st.availableToBuy)} of net revenue is queued for the first buy; each one will appear here with its price and on-chain receipt.
          </p>
        </div>
      ) : (
        <BuybackTable buybacks={buybacks} />
      )}

      {/* market */}
      <h2 className={s.sectionHead}>$MONVERA market</h2>
      <div className={s.chart}>
        <iframe title="DexScreener $MONVERA chart" src={DEXSCREENER_EMBED} />
      </div>
      <p className={s.chartNote}>Live $MONVERA / VIRTUAL market on Robinhood Chain. Each buyback above is executed against this pool.</p>

      {/* expenses */}
      <p className={s.subLabel} id="expenses">Expenses <span className={s.count}>· deducted before the 20%</span></p>
      <ul className={s.rows}>
        {expenses.map((e) => (
          <li key={e.id} className={s.row}>
            <div>
              <div className={s.rowTitle}>{e.description}</div>
              <div className={s.rowMeta}>{when(e.spentAt)}</div>
            </div>
            <div className={e.amountUsd > 0 ? s.rowValue : s.covered}>{e.amountUsd > 0 ? usd(e.amountUsd) : "Covered"}</div>
          </li>
        ))}
      </ul>

      {/* FAQ */}
      <h2 className={s.sectionHead}>FAQ</h2>
      <div className={s.faq}>
        <details className={s.faqItem}>
          <summary className={s.faqQ}>
            How much of revenue goes to buybacks?
            <ChevronDown size={18} strokeWidth={2} className={s.faqChevron} aria-hidden />
          </summary>
          <p className={s.faqA}>
            20% of net revenue (revenue after expenses). The rate is <strong>dynamic</strong> — it flexes with the agent&apos;s running costs
            and will adjust as new revenue streams are added. Today, revenue comes from Monvera&apos;s trading fees.
          </p>
        </details>
        <details className={s.faqItem}>
          <summary className={s.faqQ}>
            What are the running costs?
            <ChevronDown size={18} strokeWidth={2} className={s.faqChevron} aria-hidden />
          </summary>
          <p className={s.faqA}>
            The agent&apos;s single largest cost is AI inference, and it is currently <strong>covered by Virtuals</strong> through weekly
            inference credits (~$1,000/week), so it is not deducted from revenue for now (
            <a href="https://x.com/buildonvirtuals/status/2076732768613224605" target="_blank" rel="noreferrer">source</a>). Other expenses,
            such as the $299 DexScreener verification fee, are deducted before the 20% is calculated.
          </p>
        </details>
        <details className={s.faqItem}>
          <summary className={s.faqQ}>
            What happens to the tokens bought back?
            <ChevronDown size={18} strokeWidth={2} className={s.faqChevron} aria-hidden />
          </summary>
          <p className={s.faqA}>They are held in the treasury and directed back to the community as rewards for using Monvera.</p>
        </details>
      </div>

      {/* how it's calculated */}
      <div className={s.note}>
        <p style={{ margin: "0 0 8px" }}>
          <b>How it&apos;s calculated:</b> revenue is the USDG the treasury has collected; expenses are subtracted first; 20% of the
          remaining net revenue is the buyback budget. Buying reduces the queued amount, not the budget, so the 20% always tracks net
          revenue earned. Values update live from chain.
        </p>
        <p style={{ margin: 0 }}>
          Verify:{" "}
          <a href={`${EXPLORER}/address/${TREASURY}`} target="_blank" rel="noreferrer">treasury wallet</a> ·{" "}
          <a href={`${EXPLORER}/token/${MONVERA_CA}`} target="_blank" rel="noreferrer">$MONVERA contract</a>
          <ArrowUpRight size={13} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginLeft: 3 }} aria-hidden />
        </p>
      </div>
    </SiteDocShell>
  );
}
