import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { pageMeta, SITE_URL } from "@/lib/seo";
import { FAQ } from "@/lib/faq";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import s from "./faq.module.css";

// Public FAQ — the same answers Vera gives, indexable. Carries FAQPage
// JSON-LD so the questions are eligible for rich results; the content is the
// shared lib/faq.ts used by the in-app Help screen, so it can never drift.
export const metadata: Metadata = pageMeta({
  title: "FAQ — how Monvera works",
  description:
    "What you're buying, what it costs, how much you need to start, where your money lives, and how Vera the AI broker is verified — every answer in plain words.",
  path: "/faq",
});

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${SITE_URL}/faq#faq`,
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
  return (
    <SiteDocShell
      eyebrow="FAQ"
      title="Questions, answered plainly"
      lead={
        <>
          The same answers Vera gives in the app, in one place. Anything missing? Ask her
          directly, or email support@monvera.best.
        </>
      }
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }}
      />
      <div className={s.list}>
        {FAQ.map((f) => (
          <details key={f.q} className={s.item}>
            <summary className={s.q}>
              {f.q}
              <ChevronDown size={18} strokeWidth={2} className={s.chevron} aria-hidden />
            </summary>
            <p className={s.a}>{f.a}</p>
          </details>
        ))}
      </div>
    </SiteDocShell>
  );
}
