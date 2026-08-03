"use client";

// App-top action bar: season rewards this wallet can still claim. Same house
// pattern as RecoverBanner — claims used to live only inside the Staking page,
// and a claim window can EXPIRE (deadline, then sweep), so a user who never
// opened Staking could silently lose money that was already theirs. Money
// deadlines must be visible where the user already is, not filed away.
//
// Reads via useSeasonClaims (claims only, gentle poll) so mounting this on
// every screen never drags useStaking's heavy snapshot polling along. The bar
// doesn't claim itself — the button jumps to the Staking page, the one place
// that owns the claim write.
import { useActiveWallet } from "@/hooks/useActiveWallet";
import { useSeasonClaims } from "@/hooks/useStaking";
import { PIcon } from "./chatKit";

const WAD = BigInt(10) ** BigInt(18);

export function SeasonRewardsBanner({ onOpen }: { onOpen: () => void }) {
  // The Privy embedded EOA is the staker/claimer everywhere in the app.
  const wallet = useActiveWallet();
  const claims = useSeasonClaims((wallet?.address as `0x${string}` | undefined) ?? null);

  // Expired entries are the Staking page's story (they may already be swept —
  // nothing left to act on from a bar). Only live, unclaimed money earns one.
  const open = claims.filter((c) => !c.claimed && !c.expired);
  const total = open.reduce((sum, c) => sum + c.amount, BigInt(0));
  if (open.length === 0 || total <= BigInt(0)) return null;

  // Soonest pinned deadline drives the urgency copy; 0 = no window pinned.
  const deadlines = open.map((c) => c.deadline).filter((d) => d > 0);
  const deadline = deadlines.length > 0 ? Math.min(...deadlines) : 0;
  // 18dp → whole tokens: at season-reward sizes the decimals are just noise.
  const amount = Number(total / WAD).toLocaleString();

  return (
    <div
      role="status"
      style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--line)", background: "color-mix(in srgb, var(--primary) 9%, transparent)" }}
    >
      <PIcon name="ph-trophy" size={15} weight="fill" style={{ color: "var(--primary)", flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <b className="tnum" style={{ color: "var(--ink)" }}>{amount} $MONVERA</b> in season rewards to claim
        {deadline > 0 ? ` — expires ${new Date(deadline * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
      </span>
      <button
        onClick={onOpen}
        style={{ flex: "none", height: 30, padding: "0 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", cursor: "pointer" }}
      >
        Claim
      </button>
    </div>
  );
}
