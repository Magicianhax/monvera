import { AppShell } from "@/components/shared/AppShell";

// The Monvera app. Auth + screen routing live in the client AppShell / LiteApp.
// Reached from the marketing site (/) via "Launch app" / "Get started".
// Each in-app screen sets its own document title (see LiteApp).
export default function AppRoute() {
  return <AppShell />;
}
