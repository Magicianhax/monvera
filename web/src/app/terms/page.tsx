import type { Metadata } from "next";
import { pageMeta, SUPPORT_EMAIL } from "@/lib/seo";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import s from "../legal.module.css";

// Terms of use — plain language, honest about what Monvera is and is not.
export const metadata: Metadata = pageMeta({
  title: "Terms of Use",
  description:
    "What Monvera is (a non-custodial software interface), what it is not (a broker or advisor), the fees, the risks, and your responsibilities — in plain words.",
  path: "/terms",
});

const SECTIONS: { h: string; body: string[] }[] = [
  {
    h: "What Monvera is",
    body: [
      "Monvera is a software interface for trading tokenized stocks on Robinhood Chain. Vera, its AI agent, helps you build and place plans. Every asset you buy settles to a wallet only you control — Monvera never takes custody of your funds and cannot move them without your signature.",
    ],
  },
  {
    h: "What Monvera is not",
    body: [
      "Monvera is not a bank, broker-dealer, exchange, custodian, or investment adviser, and nothing in the app or on this site is investment, legal, or tax advice. Vera's plans, backtests, and commentary are information tools: backtests are history, not promises, and no output is a recommendation tailored to your circumstances.",
    ],
  },
  {
    h: "Eligibility and your responsibilities",
    body: [
      "You must be at least 18 and legally able to enter contracts. Monvera is available worldwide; it is your responsibility to ensure that trading tokenized stocks is lawful where you live and to handle any taxes that apply to you. You are responsible for the security of your login (email) and your devices.",
    ],
  },
  {
    h: "Fees",
    body: [
      "Trading carries no Monvera commission and no gas cost to you. Trading venues include a spread in their quoted prices, and Monvera earns a routing referral from venues on the volume it routes — the quote you see is the amount you get. When Groves go live, their only fee is 10% of realized profit at exit, measured against your own cost basis; entering, holding, and rebalancing are free. Any future fee will be disclosed in the app before it applies to you.",
    ],
  },
  {
    h: "Risks",
    body: [
      "Tokenized stocks are volatile and you can lose money, including everything you put in. Liquidity depends on third-party venues and can disappear: an asset can become temporarily impossible to buy or sell at a fair price (the app marks such names as locked). Smart contracts, blockchains, and bridges carry technical risk. Only invest what you can afford to leave, or lose.",
    ],
  },
  {
    h: "$MONVERA",
    body: [
      "$MONVERA is a community token connected to the project's story. It is not an investment product, carries no rights to revenue or governance, and is entirely separate from the tokenized stocks Vera trades.",
    ],
  },
  {
    h: "The service, as-is",
    body: [
      "Monvera is provided \"as is\" without warranties of any kind. To the maximum extent the law allows, Monvera and its contributors are not liable for indirect or consequential damages, lost profits, or losses caused by third-party venues, blockchains, wallets, or network failures. Nothing here limits liability that cannot lawfully be limited.",
    ],
  },
  {
    h: "Changes and contact",
    body: [
      `These terms can change as the product does; the current version always lives at this address, and material changes will be visible in the app. Questions: ${SUPPORT_EMAIL}.`,
    ],
  },
];

export default function TermsPage() {
  return (
    <SiteDocShell
      eyebrow="Legal"
      title="Terms of Use"
      lead={
        <>
          The deal, in plain words: Monvera is self-custodial software, not a broker — you
          stay in control of your money and your decisions. Last updated July 20, 2026.
        </>
      }
    >
      <div className={s.doc}>
        {SECTIONS.map((sec) => (
          <section key={sec.h}>
            <h2 className={s.h}>{sec.h}</h2>
            {sec.body.map((p, i) => (
              <p key={i} className={s.p}>{p}</p>
            ))}
          </section>
        ))}
      </div>
    </SiteDocShell>
  );
}
