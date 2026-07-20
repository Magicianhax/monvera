import { AppShell } from "@/components/shared/AppShell";
import { pageMeta } from "@/lib/seo";

// The Monvera app. Auth + screen routing live in the client AppShell.
// Reached from the marketing site (/) via "Launch app" / "Get started".
// Without its own canonical the page inherits the root layout's "/" and
// declares itself a duplicate of the homepage — unindexable.
export const metadata = pageMeta({
  title: "Open Monvera — talk to Vera",
  description:
    "Sign in with email and tell Vera what you want. Buy tokenized stocks of ~95 real companies and ETFs on Robinhood Chain — gasless, non-custodial, every plan shown before it moves.",
  path: "/app",
});

export default function AppRoute() {
  return <AppShell />;
}
