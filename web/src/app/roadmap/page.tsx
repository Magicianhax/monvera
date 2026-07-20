import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import { RoadmapRail } from "@/components/site/RoadmapRail";
import { countOf } from "@/lib/roadmap";

export const metadata: Metadata = pageMeta({
  title: "Roadmap",
  description:
    "What Monvera has shipped, what it is building now, and what it is exploring. No dates and no promises: the page changes when something goes live.",
  path: "/roadmap",
});

// Public, world-readable: it moves no money, so it is not geo-gated. The
// content lives in lib/roadmap.ts, shared with the landing preview.

export default function RoadmapPage() {
  return (
    <SiteDocShell
      eyebrow="Roadmap"
      title="What we are building"
      lead={
        <>
          Monvera is young, and this is the honest version of where it goes next. There are no dates here and nothing on
          this page is a promise. The line below is solid where something already works, and it thins and breaks where we
          are still guessing. {countOf("live")} things are live today.
        </>
      }
    >
      <div style={{ marginTop: "clamp(40px, 6vw, 66px)" }}>
        <RoadmapRail />
      </div>
    </SiteDocShell>
  );
}
