import type { Metadata } from "next";
import { pageMeta, SUPPORT_EMAIL } from "@/lib/seo";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import s from "../legal.module.css";

// Privacy policy — what we actually collect and why, in plain language.
export const metadata: Metadata = pageMeta({
  title: "Privacy Policy",
  description:
    "What Monvera collects (very little), why, who processes it, and how to get it deleted — in plain words. No ad tracking, no data sales.",
  path: "/privacy",
});

const SECTIONS: { h: string; body: string[] }[] = [
  {
    h: "The short version",
    body: [
      "Monvera collects the minimum needed to run a self-custodial trading app: your login email, your wallet addresses, and your conversations with Vera. We do not run ad trackers, we do not sell data, and your money never touches our servers — it lives on-chain in a wallet only you control.",
    ],
  },
  {
    h: "What we collect",
    body: [
      "Account: the email you sign in with, handled by Privy (our authentication and embedded-wallet provider), and the wallet addresses created for or connected by you.",
      "Chat: your conversations with Vera, stored so your history survives a refresh and follows you across devices. They are keyed to your account and never shared.",
      "Usage: standard server logs (IP, user agent, timestamps) for security and debugging, and error reports without personal content. Preferences like theme live in your own browser's storage.",
      "On-chain: your trades and transfers are public blockchain data by nature — that is what makes the app verifiable, and it is visible to anyone regardless of Monvera.",
    ],
  },
  {
    h: "What we never collect",
    body: [
      "Your private keys (they stay with Privy's embedded wallet under your control), payment cards, government IDs, or browsing behavior outside the app. There is no advertising SDK and no analytics profile built on you.",
    ],
  },
  {
    h: "Who processes data",
    body: [
      "Privy (login and embedded wallets), Cloudflare (hosting, storage, and network security), the AI inference provider that powers Vera's replies (your message text is sent to generate a response, without your email attached), and the trading venues that receive only the wallet address and trade parameters needed to quote and settle. Each processes data to provide their service to you, nothing more.",
    ],
  },
  {
    h: "Retention and deletion",
    body: [
      `Chat history and account records are kept while your account exists. Email ${SUPPORT_EMAIL} from your sign-in address and we will delete your stored chat history and account data — on-chain transactions are permanent by design and outside anyone's power to erase.`,
    ],
  },
  {
    h: "Changes and contact",
    body: [
      `This policy changes when the product does; the current version always lives at this address. Questions or requests: ${SUPPORT_EMAIL}.`,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <SiteDocShell
      eyebrow="Legal"
      title="Privacy Policy"
      lead={
        <>
          A self-custodial app needs surprisingly little of your data — here is exactly what
          Monvera touches and what it never will. Last updated July 20, 2026.
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
