import { pageMeta } from "@/lib/seo";
import { PublicStake } from "@/components/staking/PublicStake";

// Public staking — deliberately outside /app: no Monvera account, no smart
// wallet, no login. Any browser wallet can stake, and the season leaderboard
// is readable with no wallet at all.
export const metadata = pageMeta({
  title: "Stake $MONVERA",
  description:
    "Stake $MONVERA and earn a slice of a 2,000,000 $MONVERA season pool, credited to your address every epoch. Stake 500k+ to run your own Grove and earn up to half its fees. Any wallet, no account needed.",
  path: "/stake",
});

export default function StakeRoute() {
  return <PublicStake />;
}
