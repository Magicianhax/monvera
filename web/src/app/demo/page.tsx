import type { Metadata } from "next";
import { DemoMount } from "@/components/demo/DemoMount";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Try Monvera with demo data, no login. See how Vera turns a sentence into a real portfolio of tokenized stocks.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Monvera · Live demo",
    description:
      "Try Monvera with demo data, no login. See how Vera turns a sentence into a real portfolio.",
    url: "/demo",
  },
};

// Auth-free, demo-data preview of the real Monvera app — embedded by the marketing
// site phones and viewable directly at /demo. `?play=invest|vera` auto-plays a
// scripted walkthrough; no param = fully interactive. `?mode=dark` flips theme.
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ play?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const play = sp.play === "invest" || sp.play === "vera" ? sp.play : null;
  const mode = sp.mode === "light" ? "light" : "dark";
  return <DemoMount play={play} mode={mode} />;
}
