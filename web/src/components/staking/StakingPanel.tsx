"use client";

// StakingPanel — the staking surface, shared by the in-app page and /stake.
//
// Visual direction: the project's own Ledger system (DESIGN.md), not a borrowed
// one. Flat solid panels, 1px hairlines instead of elevation, radii 4-8px,
// left-aligned stat blocks, section headers at 13/700. The brand green is
// earned — primary actions and the one number that matters per group, never
// decoration. Everything runs through CSS variables so the same component is
// correct in light, dark and all six palettes.
//
// Every money action goes through ConfirmDialog first: the user reads exactly
// what the transaction does, in plain words, BEFORE any wallet signs.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatUnits } from "viem";
import { PIcon } from "@/components/chat/chatKit";
import { useStaking, type ClaimableSeason, type StakingAction, type StakerRewards } from "@/hooks/useStaking";
import type { StakingWallet } from "@/hooks/useStakingWallet";
import {
  CURATOR_GATE,
  EPOCH_REWARD,
  EPOCH_SECONDS,
  SEASON_EPOCHS,
  SEASON_POOL,
  SEASON_START_UTC,
  STAKING_TESTNET,
} from "@/lib/staking";

/** Token amounts for display. FLOORS rather than rounds: toLocaleString rounds
 *  half-up, so a wallet holding 120,337.65 rendered as "120,338" — more than the
 *  user actually has. Typing that figure back was then rejected as over balance,
 *  by an error message quoting the same number. A balance or an earned figure
 *  must never overstate; truncating at the wei level is the honest direction. */
const fmt = (raw: bigint, dp = 0) => {
  const scale = BigInt(10) ** BigInt(18 - dp);
  return Number(formatUnits((raw / scale) * scale, 18)).toLocaleString(undefined, { maximumFractionDigits: dp });
};
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** The user's typed amount, verbatim, with thousands separators but WITHOUT
 *  rounding. A signing surface must never state a number other than the one
 *  being signed: num() turned 0.4 into "0" and 1234.75 into "1,235". */
const exact = (raw: string) => {
  const [i, d] = raw.trim().split(".");
  const whole = Number(i || "0").toLocaleString(undefined, { maximumFractionDigits: 0 });
  return d ? `${whole}.${d}` : whole;
};

/** Semantic stacking order — no magic numbers anywhere in the tree. */
export const Z = { sticky: 30, dropdown: 40, modal: 60 } as const;

/** Leaderboard rows shown per page. The table always renders this many slots
 *  (real stakers then empty placeholders) so its height never jumps. */
const LEADERBOARD_PAGE = 10;

const FAQ_ITEMS: { q: string; a: string }[] = [
  { q: "What is an epoch?", a: `One epoch is 24 hours, running midnight to midnight UTC. Each epoch pays out a fixed slice of the season pool, split across stakers by stake-time. When an epoch closes your share of it banks to your address and never moves again.` },
  { q: "What do I earn?", a: `A slice of the pool every epoch. Your share is credited to your address when the epoch closes, it only ever adds up, and you claim the lot on-chain when the season ends. The tokens themselves move once, at season close.` },
  { q: "How big is Season 1?", a: `A ${SEASON_POOL.toLocaleString()} $MONVERA pool over ${SEASON_EPOCHS} epochs, about ${EPOCH_REWARD.toLocaleString()} per epoch. Each epoch settles on its own, so getting in early and holding pays: a latecomer can never dilute an epoch you already earned.` },
  { q: "How is my share worked out?", a: `Purely by stake-time within each epoch. The more you stake and the longer you hold it, the bigger your share. One rule for everyone, no multipliers, no cap.` },
  { q: "Where do the rewards come from?", a: `Straight from the team's own allocation, the share of the fixed supply that starts unlocking in October. We are putting our own tokens behind the people who stake. Supply stays capped at one billion, nothing minted.` },
  { q: "When can I claim?", a: `When the season closes. Your earnings are credited to your address every epoch as you go. Nothing moves on-chain until the season closes, then the claim opens: one tap, straight to your wallet.` },
  { q: "What is the unstake cooldown?", a: `Unstaking is request, wait out the cooldown, then withdraw. The wait keeps the season fair, so nobody flash-stakes at the last minute, and you can cancel and put it back to work any time before it clears.` },
  { q: "What does staking unlock?", a: `Plenty. At ${CURATOR_GATE.toLocaleString()}+ staked you can run your own Grove and earn up to half of its performance fee. Staked holders are also first in line for what is next: a bigger say in Vera's strategies, early access to new features, and a seat in the agent economy she is building.` },
  { q: "Can my stake be locked or taken?", a: `Never. The staking contract has no owner, no pause, and no upgrade path. Your stake is always yours to pull after the cooldown.` },
  { q: "How are rewards calculated, and can I check them?", a: `From the public staking events on-chain, by the same open model that produces the merkle root you claim against. Each epoch's fixed amount is split by stake-time, so anyone can recompute the numbers from chain data and get the same answer. When you claim, your proof is checked against the root stored in the contract, so a wrong figure cannot pay out.` },
  { q: "What are the risks?", a: `Rewards are variable, not a rate: your share depends on total stake, so it falls as more people stake. Seasons are discretionary and sized in advance, not promised. $MONVERA's price can fall, including below what you paid. Once you request an unstake the amount is locked for the cooldown and earns nothing while it cools.` },
];

// ── shared stylesheet ───────────────────────────────────────────────────────
// Inline styles can't express :hover / :active / :focus-visible / reduced
// motion, which is exactly why the first pass had none of them. One scoped
// sheet covers every interactive state for both surfaces.

export const STAKING_CSS = `
.mvs{--mv-ease:cubic-bezier(.23,1,.32,1)}
.mvs button{font:inherit;cursor:pointer;color:inherit}
.mvs .mvbtn{transition:transform 160ms var(--mv-ease),background-color 160ms ease,border-color 160ms ease,color 160ms ease}
.mvs .mvbtn:active:not(:disabled){transform:scale(.97)}
.mvs .mvbtn:disabled{opacity:.45;cursor:not-allowed}
.mvs .mvbtn:focus-visible,.mvs .mvinput:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.mvs .mvinput{transition:border-color 160ms ease}
.mvs .mvinput:focus{border-color:var(--primary);outline:none}
.mvs .mvrow{transition:background-color 160ms ease}
@media (hover:hover) and (pointer:fine){
  .mvs .mvbtn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--primary) 88%,#fff)}
  .mvs .mvbtn-quiet:hover:not(:disabled){border-color:var(--ink-3);color:var(--ink)}
  .mvs .mvrow:hover{background:var(--panel-2)}
  .mvs .mvlink:hover{color:var(--ink)}
}
@keyframes mvspin{to{transform:rotate(360deg)}}
.mvspin{animation:mvspin .7s linear infinite}
.mvbackdrop{opacity:1;transition:opacity 180ms var(--mv-ease)}
@starting-style{.mvbackdrop{opacity:0}}
.mvdialog{opacity:1;transform:scale(1);transform-origin:center;transition:opacity 200ms var(--mv-ease),transform 200ms var(--mv-ease)}
@starting-style{.mvdialog{opacity:0;transform:scale(.96)}}
/* Stat grids size to their CONTAINER, not the viewport: in-app this panel
   lives inside a ~420px device frame on a 1440px screen, so media queries
   would read the wrong width. Fixed column counts that divide the item count
   evenly (3 and 6) mean a slot is never left empty. */
.mvs-sections{container-type:inline-size}
.mvs-g3,.mvs-g6{display:grid;grid-template-columns:repeat(3,1fr)}
@container (max-width:700px){.mvs-g6{grid-template-columns:repeat(2,1fr)}}
@container (max-width:520px){.mvs-g3{grid-template-columns:1fr}}
@container (max-width:330px){.mvs-g6{grid-template-columns:1fr}}
/* Narrow containers: drop the rank column and tighten cells so the reward
   number — the one people came for — fits without sideways scrolling. */
@container (max-width:520px){
  .mvs-rank{display:none}
  .mvs-tb th,.mvs-tb td{padding-left:11px!important;padding-right:11px!important}
}
/* Phones: tighten the gutters and drop the secondary nav link so the header
   fits 360px. !important because the surfaces style inline. */
@media (max-width:560px){
  .mvs-hd{padding:11px 14px!important}
  .mvs-hd-app{display:none!important}
  .mvs-wrap{padding-left:16px!important;padding-right:16px!important}
  .mvs-sections{gap:32px!important}
}
@media (prefers-reduced-motion:reduce){
  .mvs .mvbtn,.mvs .mvinput,.mvs .mvrow,.mvbackdrop,.mvdialog{transition-duration:1ms}
  .mvs .mvbtn:active:not(:disabled){transform:none}
  .mvdialog{transform:none}
  .mvspin{animation:none;opacity:.55}
}
.mvs details.mvfq{border-top:1px solid var(--line)}
.mvs details.mvfq:first-of-type{border-top:none}
.mvs details.mvfq summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:15px 18px;font-size:13.5px;font-weight:650;color:var(--ink)}
.mvs details.mvfq summary::-webkit-details-marker{display:none}
.mvs details.mvfq summary .mvcaret{margin-left:auto;flex:none;color:var(--ink-3);transition:transform 180ms var(--mv-ease)}
.mvs details.mvfq[open] summary .mvcaret{transform:rotate(90deg)}
.mvs details.mvfq .mvans{padding:0 18px 16px;font-size:12.5px;line-height:1.6;color:var(--ink-2)}
/* Two-column: position+actions beside the leaderboard on wide containers,
   stacked when narrow (in-app device frame, phones). */
.mvs-split{display:grid;gap:40px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:stretch}
.mvs-split>section{display:flex;flex-direction:column;min-width:0}
.mvs-fill{flex:1;display:flex;flex-direction:column}
@container (max-width:760px){.mvs-split{grid-template-columns:1fr}}
/* Position tiles auto-flow to the column width, so nothing squishes or leaves a ragged empty slot. */
.mvs-pos{display:grid;grid-template-columns:repeat(3,1fr)}
@container (max-width:360px){.mvs-pos{grid-template-columns:1fr}}
`;

// ── primitives ──────────────────────────────────────────────────────────────

/** A standalone panel. Never nests — anything inside is separated by hairlines. */
const panel: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  overflow: "hidden",
};
/** Ledger section header: 13/700/--ink-2, no tracked uppercase kicker. */
const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "var(--ink-2)", letterSpacing: "-.005em",
};
const meta: React.CSSProperties = { fontSize: 11.5, color: "var(--ink-3)" };
/** Separators are per-cell borders pulled back 1px, not a gap over a tinted
 *  grid background — the gap trick painted any unfilled slot as a grey block
 *  on phones. The panel's overflow:hidden clips the outermost borders.
 *  Cells fill solid --bg, never --panel: this theme's --panel is a translucent
 *  diagonal gradient, and one copy per cell made each stat a different tone. */
const statCell: React.CSSProperties = {
  minWidth: 0,
  padding: "15px 18px",
  background: "var(--bg)",
  borderLeft: "1px solid var(--line)",
  borderTop: "1px solid var(--line)",
  marginLeft: -1,
  marginTop: -1,
};
const btn = (kind: "primary" | "quiet"): React.CSSProperties => ({
  height: 40, padding: "0 18px", borderRadius: 6, fontSize: 13.5, fontWeight: 700,
  background: kind === "primary" ? "var(--primary)" : "transparent",
  color: kind === "primary" ? "var(--primary-ink)" : "var(--ink-2)",
  border: kind === "primary" ? "1px solid transparent" : "1px solid var(--line)",
  whiteSpace: "nowrap",
});
const chip: React.CSSProperties = {
  height: 26, padding: "0 10px", borderRadius: 5, border: "1px solid var(--line)",
  fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)", background: "transparent",
};
const tag = (): React.CSSProperties => ({
  padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700,
  background: "color-mix(in srgb, var(--primary) 13%, transparent)", color: "var(--primary)",
});

/** Stat block — left-aligned, label above number, sits directly on the panel.
 *  `compact` shrinks the value + padding so three fit one row in a narrow column. */
function Stat({ label, value, sub, accent, compact }: {
  label: string; value: string; sub?: string; accent?: boolean; compact?: boolean;
}) {
  return (
    <div style={compact ? { ...statCell, padding: "11px 14px" } : statCell}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)" }}>{label}</div>
      <div
        className="tnum"
        style={{
          fontSize: compact ? 16.5 : 22, fontWeight: 700, letterSpacing: "-.02em", marginTop: 3,
          color: accent ? "var(--primary)" : "var(--ink)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

/** Slim season-wide strip: a progress ring on the side + live headline numbers.
 *  Everything is derivable now (config + on-chain totalStaked); no endpoint. */
/** "5h 12m" far out, "12m 04s" in the last hour — the closer the epoch flip,
 *  the finer the resolution, so the last minutes actually feel like a countdown. */
const fmtLeft = (s: number) => {
  if (s <= 0) return "any moment";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(sec).padStart(2, "0")}s`;
};

function SeasonStrip({ totalStaked, stakers }: { totalStaked: bigint | null; stakers: number | null }) {
  const staked = totalStaked !== null ? Number(formatUnits(totalStaked, 18)) : null;
  // Ticks every second so the countdown to the next epoch is live rather than
  // frozen until the next 20s poll.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const started = SEASON_START_UTC > 0;
  // Epochs fully CLOSED so far (this is exactly what has banked).
  const ended = started
    ? Math.max(0, Math.min(SEASON_EPOCHS, Math.floor((nowSec - SEASON_START_UTC) / EPOCH_SECONDS)))
    : 0;
  const current = Math.min(SEASON_EPOCHS, ended + 1); // 1-based, the one accruing now
  const left = SEASON_EPOCHS - ended;
  const nextEpochAt = SEASON_START_UTC + (ended + 1) * EPOCH_SECONDS;
  const untilNext = started ? nextEpochAt - nowSec : 0;

  const elapsed = ended;
  const earned = Math.min(SEASON_POOL, elapsed * EPOCH_REWARD); // aggregate paid to date
  const remaining = SEASON_POOL - earned;
  const pct = Math.round((earned / SEASON_POOL) * 100);
  // Implied annualized rate at the current stake. Live and variable, never a promise.
  const rate = staked && staked > 0 ? Math.round((SEASON_POOL / staked) * (365 / SEASON_EPOCHS) * 100) : null;

  const R = 28, C = 2 * Math.PI * R;
  const ringStat = (label: string, value: string, accent?: boolean) => (
    <div style={{ flex: 1, minWidth: 92 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: accent ? "var(--primary)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ ...panel, display: "flex", alignItems: "center", gap: 20, padding: "16px 22px", flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 68, height: 68, flex: "none" }}>
        <svg width="68" height="68" viewBox="0 0 68 68" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="34" cy="34" r={R} fill="none" stroke="var(--line)" strokeWidth="5" />
          <circle cx="34" cy="34" r={R} fill="none" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - earned / SEASON_POOL)} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <span className="tnum" style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{pct}%</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-2)", marginBottom: 10 }}>
          Season 1{" "}
          {started ? (
            <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>
              · epoch {current} of {SEASON_EPOCHS} · {ended} ended, {left} left
            </span>
          ) : (
            <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>· not started</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, rowGap: 12, flexWrap: "wrap" }}>
          {ringStat("Remaining", num(remaining))}
          {ringStat("Total staked", staked !== null ? num(staked) : "—")}
          {ringStat("Stakers", stakers !== null ? num(stakers) : "—")}
          {ringStat("Per epoch", num(EPOCH_REWARD))}
          {ringStat("Pool vs staked", rate !== null ? `${rate}%` : "—")}
          {ringStat("Next epoch in", started ? fmtLeft(untilNext) : "—")}
        </div>
        {/* The variability line sits INSIDE the strip, next to the ratio, so the
            number can never be screenshotted without its caveat. "Pool vs
            staked" is a live ratio against current total stake, not an offered
            rate, and it falls as more people stake. */}
        {/* No ch-based measure: 72ch fell far short of the strip's width, so the
            caveat folded into a narrow ragged column with the right half empty.
            It runs the full strip and wraps naturally instead. */}
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5, textWrap: "pretty" }}>
          Pool vs staked is the season pool measured against everything staked right now, annualised. It is not a rate we
          offer: it moves with total stake and falls as more people join. Rewards are variable and $MONVERA&apos;s value
          can fall.
        </div>
      </div>
    </div>
  );
}

/** Claimable-rewards card. Always shown to a connected wallet: once a season
 *  closes and this wallet has an entry it lists claimable seasons; before then it
 *  shows a single locked row so the claim path is visible and self-explaining
 *  rather than hidden. Each row claims independently; the header sums what's still
 *  unclaimed. */
function ClaimCard({ claims, rewards, busy, onClaim }: {
  claims: ClaimableSeason[]; rewards?: StakerRewards; busy: boolean; onClaim: (c: ClaimableSeason) => void;
}) {
  const hasClaims = claims.length > 0;
  const totalClaimable = claims.filter((c) => !c.claimed).reduce((a, c) => a + c.amount, BigInt(0));
  // Before a season closes there is nothing claimable ON-CHAIN yet, but the
  // staker has still earned something. Showing a dash there read as "you have
  // nothing", so the header falls back to the earned figure and the row below
  // says when it unlocks.
  const headline = hasClaims ? totalClaimable : rewards?.bankedSoFar;
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "15px 18px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PIcon name="ph-hand-coins" size={16} weight="fill" />
          <span style={sectionTitle}>{hasClaims ? "Claimable rewards" : "Season rewards"}</span>
        </div>
        <div className="tnum" style={{ fontSize: 15, fontWeight: 700, color: hasClaims && headline && headline > BigInt(0) ? "var(--primary)" : "var(--ink)" }}>
          {headline !== undefined ? fmt(headline) : "—"} <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>$MONVERA</span>
        </div>
      </div>

      {hasClaims ? (
        claims.map((c, i) => (
          <div key={c.seasonId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink)" }}>Season {c.seasonId + 1}</div>
              <div className="tnum" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                {fmt(c.amount)} $MONVERA{c.deadline > 0 ? (c.expired ? " · window closed" : " · window open") : ""}
              </div>
            </div>
            {c.claimed ? (
              <span style={{ ...tag(), display: "inline-flex", alignItems: "center", gap: 5 }}>
                <PIcon name="ph-check" size={11} weight="bold" /> Claimed
              </span>
            ) : (
              <button
                className="mvbtn mvbtn-primary"
                style={{ ...btn("primary"), height: 34, padding: "0 16px" }}
                disabled={busy}
                onClick={() => onClaim(c)}
              >
                {busy ? "Claiming…" : "Claim"}
              </button>
            )}
          </div>
        ))
      ) : (
        // Locked state — no closed-season entry yet. Show the path, disabled.
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink)" }}>Claim opens after the season ends</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.5 }}>
              That is what you have earned so far. It is added to this address at the end of every epoch, only ever goes up, and becomes claimable on-chain when Season 1 closes.
            </div>
          </div>
          <button
            className="mvbtn mvbtn-primary"
            style={{ ...btn("primary"), height: 34, padding: "0 16px", display: "inline-flex", alignItems: "center", gap: 6 }}
            disabled
            title="Claiming opens when the season ends"
          >
            <PIcon name="ph-lock" size={12} weight="bold" /> Claim
          </button>
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <h2 style={sectionTitle}>{title}</h2>
      {right}
    </div>
  );
}

// ── confirm dialog ──────────────────────────────────────────────────────────

interface Plan {
  action: StakingAction;
  title: string;
  amount?: string;
  points: string[];
  cta: string;
  run: () => void;
}

function ConfirmDialog({ plan, wallet, onClose }: { plan: Plan; wallet: StakingWallet; onClose: () => void }) {
  // PORTALLED TO document.body ON PURPOSE. The panel root carries
  // `container-type: inline-size` (see .mvs-sections in STAKING_CSS), and a
  // container query container is a containing block for fixed-position
  // descendants. Rendered in place, this "fixed" overlay resolved against the
  // panel rather than the viewport, so on a narrow screen the confirm dialog
  // was clipped inside the column and no transaction could be signed. The
  // portal escapes the container. No mount flag is needed: this component is
  // only rendered once `plan` is non-null, and `plan` is only ever set by a
  // click, so it never renders on the server. The `document` check below is
  // pure belt-and-braces — cheaper and quieter than a state+effect round-trip.

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={plan.title}
      onClick={onClose}
      className="mvs mvbackdrop"
      style={{
        position: "fixed", inset: 0, zIndex: Z.modal, background: "rgba(4,10,7,.72)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mvdialog"
        // Solid --bg UNDER the --panel glass. In place, this panel sits on an
        // opaque page so its translucency reads as glass; floating over the
        // backdrop it had nothing behind it, and the page showed straight
        // through the one surface that must be legible — the screen stating
        // what is about to be signed. Layering keeps the look and the contrast.
        style={{ ...panel, background: "var(--panel), var(--bg)", borderRadius: 10, width: "100%", maxWidth: 420, padding: 22 }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", textWrap: "balance" }}>{plan.title}</div>

        {plan.amount ? (
          <div style={{ margin: "16px 0", padding: "13px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)" }}>Amount</div>
            <div className="tnum" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", marginTop: 3 }}>
              {plan.amount} <span style={{ fontSize: 13.5, color: "var(--ink-3)", fontWeight: 600 }}>$MONVERA</span>
            </div>
          </div>
        ) : (
          <div style={{ height: 16 }} />
        )}

        <ul style={{ listStyle: "none", display: "grid", gap: 9, margin: 0, padding: 0 }}>
          {plan.points.map((p) => (
            <li key={p} style={{ display: "flex", gap: 9, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              <span style={{ flex: "none", marginTop: 6, width: 3, height: 3, borderRadius: 99, background: "var(--primary)" }} />
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <div style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "16px 0", paddingTop: 13, borderTop: "1px solid var(--line)", lineHeight: 1.5 }}>
          {wallet.silentSigning
            ? `Signed by ${wallet.label}. No second prompt after this.`
            : `${wallet.label} will ask you to confirm next.`}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="mvbtn mvbtn-quiet" onClick={onClose} style={{ ...btn("quiet"), flex: "none" }}>Cancel</button>
          <button className="mvbtn mvbtn-primary" onClick={() => { plan.run(); onClose(); }} style={{ ...btn("primary"), flex: 1 }}>{plan.cta}</button>
        </div>
      </div>
    </div>
  );

  // ...but NOT to document.body. Every theme token (--panel, --bg, --ink,
  // --line) is declared on the .mvc/.mvm root, so a dialog parked on <body>
  // resolved all of them to nothing: no panel background, no borders, just
  // unreadable text floating over the page — on the one surface that has to
  // state exactly what is about to be signed. The theme root is an ANCESTOR of
  // the .mvs-sections container-type, so mounting there escapes the containing
  // block and keeps the tokens. Falls back to body if the root ever moves.
  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.querySelector(".mvc, .mvm") ?? document.body);
}

// ── panel ───────────────────────────────────────────────────────────────────

export function StakingPanel({
  wallet,
  connectSlot,
}: {
  wallet: StakingWallet;
  /** Public page: the connect control. Omitted in-app (already signed in). */
  connectSlot?: React.ReactNode;
}) {
  const s = useStaking(wallet);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const snap = s.snapshot;

  const amountNum = Number(amount);
  const amountOk = amount.trim() !== "" && isFinite(amountNum) && amountNum > 0;
  const stakedNum = snap ? Number(formatUnits(snap.staked, 18)) : 0;
  const walletNum = snap ? Number(formatUnits(snap.wallet, 18)) : 0;
  const curatorEligible = stakedNum >= CURATOR_GATE;
  const rewards = snap?.rewards;
  // Position on the leaderboard, which is already sorted by stake.
  const myRankIdx = snap && wallet.address
    ? snap.leaderboard.findIndex((r) => r.address.toLowerCase() === wallet.address!.toLowerCase())
    : -1;
  const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;
  // A cooldown that clears while the page is open must enable Withdraw by
  // itself. Reading Date.now() straight in the render body froze unlockPassed at
  // whatever it was on first paint (and made the render impure), so the button
  // stayed greyed out until a manual reload. One timer, armed for the exact
  // moment the cooldown ends — no polling, and it re-arms if unlockAt changes.
  const unlockAtMs = snap && snap.unlockAt > 0 ? snap.unlockAt * 1000 : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (unlockAtMs === null) return;
    const delay = unlockAtMs - Date.now();
    if (delay <= 0) return;
    const id = setTimeout(() => setNowMs(Date.now()), delay + 500);
    return () => clearTimeout(id);
  }, [unlockAtMs]);
  const unlockDate = unlockAtMs !== null ? new Date(unlockAtMs) : null;
  const unlockPassed = unlockAtMs !== null && unlockAtMs <= nowMs;
  const cooldownLabel = snap
    ? snap.cooldownSeconds >= 86400
      ? `${Math.round(snap.cooldownSeconds / 86400)} day${snap.cooldownSeconds >= 172800 ? "s" : ""}`
      : `${Math.round(snap.cooldownSeconds / 3600)} hour${snap.cooldownSeconds >= 7200 ? "s" : ""}`
    : "—";
  const connected = !!wallet.address;

  const plans = useMemo(() => ({
    stake: (): Plan => {
      const after = stakedNum + amountNum;
      const points = [
        `${exact(amount)} $MONVERA moves from your wallet into the staking contract.`,
        "It starts counting stake-time straight away, which is how each day's bucket is split.",
        `Unstaking later takes ${cooldownLabel}; a pending unstake can be cancelled any time.`,
      ];
      if (!curatorEligible && after >= CURATOR_GATE) {
        points.push(`Puts you at ${num(after)} staked, past the ${num(CURATOR_GATE)} curator threshold.`);
      }
      points.push("The contract has no owner and no pause: nobody can move or lock your stake.");
      return { action: "stake", title: "Stake $MONVERA", amount: exact(amount), points, cta: "Confirm stake", run: () => { void s.stake(amount); setAmount(""); } };
    },
    unstake: (): Plan => {
      const points = [
        `${exact(amount)} $MONVERA moves from staked into cooling down.`,
        "It stops counting toward rewards the moment this confirms.",
        `Withdrawable after ${cooldownLabel}, or cancel and put it back to work before then.`,
        stakedNum - amountNum < CURATOR_GATE && curatorEligible
          ? `This drops you below the ${num(CURATOR_GATE)} curator threshold.`
          : "Your remaining stake keeps accruing normally.",
      ];
      return {
        action: "unstake",
        title: "Request unstake",
        amount: exact(amount),
        points,
        cta: "Confirm request",
        run: () => { void s.requestUnstake(amount); setAmount(""); },
      };
    },
    cancel: (): Plan => ({
      action: "cancel",
      title: "Cancel unstake",
      amount: snap ? fmt(snap.pending) : undefined,
      points: [
        "Your cooling-down balance goes straight back into the stake.",
        "It starts counting toward rewards again and the cooldown clears.",
      ],
      cta: "Confirm cancel",
      run: () => void s.cancelUnstake(),
    }),
    withdraw: (): Plan => ({
      action: "withdraw",
      title: "Withdraw",
      amount: snap ? fmt(snap.pending) : undefined,
      points: [
        "Your cooled-down $MONVERA returns to your wallet.",
        "Rewards you have already banked this season stay yours.",
      ],
      cta: "Confirm withdraw",
      run: () => void s.withdraw(),
    }),
    mint: (): Plan => ({
      action: "mint",
      title: "Mint test tokens",
      amount: "500,000",
      points: [
        "Testnet only: tMONVERA has an open mint so anyone can try the full flow.",
        "Worthless test tokens on Robinhood Chain Testnet, not real $MONVERA.",
      ],
      cta: "Mint",
      run: () => void s.mintTest(),
    }),
  }), [amount, amountNum, cooldownLabel, curatorEligible, s, snap, stakedNum]);

  /** Confirm plan for claiming a closed season's banked reward. */
  const claimPlan = (c: ClaimableSeason): Plan => ({
    action: "claim",
    title: `Claim Season ${c.seasonId + 1}`,
    amount: fmt(c.amount),
    points: [
      "Your banked $MONVERA for this season transfers straight to your wallet.",
      "One claim per season, and the amount was fixed when the season closed.",
      c.expired
        ? "This season's claim window has closed, so claim promptly: the unclaimed remainder can be swept back to the treasury."
        : "You can claim any time before the window closes.",
    ],
    cta: "Confirm claim",
    run: () => void s.claim(c.seasonId, c.amount, c.proof),
  });

  /** Validate before the dialog opens — and say what's wrong instead of
   *  greying a button out, which reads as "the app is broken". */
  const guard = (kind: "stake" | "unstake") => {
    setLocalError(null);
    if (!amountOk) return setLocalError(`Enter an amount to ${kind} first.`);
    // Never assert a balance we have not actually read. Without this, a slow or
    // failing snapshot leaves walletNum at its 0 fallback and a funded wallet is
    // told "You hold 0 $MONVERA", which is a false statement about their money.
    if (!snap) {
      return setLocalError("Still reading your balances. Give it a second and try again.");
    }
    // Quote the balance through fmt (floored), matching the tiles above. num()
    // rounds, so it could name a figure larger than the one being rejected.
    if (kind === "stake" && amountNum > walletNum) {
      return setLocalError(`You hold ${fmt(snap.wallet)} $MONVERA, which is the most you can stake.`);
    }
    if (kind === "unstake" && amountNum > stakedNum) {
      return setLocalError(stakedNum > 0
        ? `You have ${fmt(snap.staked)} staked, so you cannot unstake more than that.`
        : "You don't have anything staked yet.");
    }
    setPlan(kind === "stake" ? plans.stake() : plans.unstake());
  };

  /** Fill the amount with `pct`% of a base balance (wallet for stake, staked for
   *  unstake). Computed in WEI, not in display tokens: flooring to whole tokens
   *  made "100%" leave every fractional balance behind (and any balance under 1
   *  resolve to 0). Integer division still floors, so the input can never exceed
   *  the base, and 100% now returns the base exactly. Stretches to an equal
   *  share of the row so 25/50/75/100 span the full input width. */
  const pctChip = (pct: number, base: bigint) => (
    <button
      key={pct}
      className="mvbtn mvbtn-quiet"
      onClick={() => { setLocalError(null); setAmount(base > BigInt(0) ? formatUnits((base * BigInt(pct)) / BigInt(100), 18) : ""); }}
      style={{ ...chip, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      {pct}%
    </button>
  );

  const cell = { padding: "12px 18px", borderTop: "1px solid var(--line)" };

  // minWidth:0 on every grid child is load-bearing: without it a grid item's
  // default min-width:auto grows to its widest content (the 460px leaderboard
  // table), blowing the whole page past the viewport on phones.
  const sec: React.CSSProperties = { minWidth: 0 };

  return (
    <div className="mvs mvs-sections" style={{ display: "grid", gap: 24, minWidth: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: STAKING_CSS }} />

      {/* ── season strip (both surfaces): live headline numbers + progress ring ── */}
      <SeasonStrip totalStaked={snap ? snap.totalStaked : null} stakers={snap ? snap.leaderboard.length : null} />

      {/* ── claimable rewards: shown to any connected wallet — lists claimable
           seasons once one closes, otherwise a locked "opens after season" row ── */}
      {connected && (
        <ClaimCard claims={s.claims} rewards={rewards} busy={s.busy !== null} onClaim={(c) => setPlan(claimPlan(c))} />
      )}

      {/* ── position + actions (left) | leaderboard (right) ── */}
      <div className="mvs-split">
      <section style={sec}>
        <SectionHead
          title="Your position"
          right={
            <>
              {connected && <span className="tnum" style={meta}>{short(wallet.address!)}</span>}
              {curatorEligible && <span style={tag()}>Curator eligible</span>}
            </>
          }
        />

        <div className="mvs-fill" style={panel}>
          {!connected ? (
            <div style={{ padding: "34px 22px", textAlign: "center", flex: 1, display: "grid", alignContent: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 8, textWrap: "balance" }}>
                Connect to stake
              </div>
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, maxWidth: "46ch", margin: "0 auto 20px", textWrap: "pretty" }}>
                Sign in with email, Google or X and a wallet is created for you, or connect the wallet you already use.
                Either way the stake stays yours and rewards bank to your address.
              </p>
              {connectSlot}
            </div>
          ) : (
            <>
              {/* Everything wallet-specific lives HERE, not in the season strip:
                  the strip is the season, this panel is you. Two rows of three,
                  which is why the tiles are compact. */}
              <div className="mvs-pos">
                <Stat label="Wallet" value={snap ? fmt(snap.wallet) : "—"} compact />
                <Stat label="Staked" value={snap ? fmt(snap.staked) : "—"} accent compact />
                <Stat
                  label="Cooling down"
                  value={snap && snap.pending > BigInt(0) ? fmt(snap.pending) : "0"}
                  sub={unlockDate ? (unlockPassed ? "ready" : `${unlockDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${unlockDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`) : undefined}
                  compact
                />
                <Stat label="Earned so far" value={rewards ? fmt(rewards.bankedSoFar) : "—"} accent compact />
                <Stat label="This epoch" value={rewards ? fmt(rewards.todayAccruing) : "—"} sub="accruing" compact />
                <Stat
                  label="Rank"
                  value={myRank !== null ? `#${myRank}` : "—"}
                  sub={snap && snap.leaderboard.length > 0 ? `of ${num(snap.leaderboard.length)}` : undefined}
                  compact
                />
              </div>

              {/* amount + actions — tabbed: pick stake or unstake, one clear flow each */}
              <div style={{ padding: 18, borderTop: "1px solid var(--line)" }}>
                <div role="tablist" aria-label="Stake or unstake" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                  {(["stake", "unstake"] as const).map((m) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={mode === m}
                      className="mvbtn"
                      onClick={() => { setMode(m); setLocalError(null); setAmount(""); }}
                      style={{
                        flex: 1, height: 34, borderRadius: 6, fontSize: 13.5, fontWeight: 700, border: "1px solid transparent",
                        background: mode === m ? "var(--panel)" : "transparent",
                        color: mode === m ? "var(--ink)" : "var(--ink-3)",
                      }}
                    >
                      {m === "stake" ? "Stake" : "Unstake"}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <input
                    value={amount}
                    onChange={(e) => { setLocalError(null); setAmount(e.target.value.replace(/[^0-9.]/g, "")); }}
                    placeholder="Amount"
                    inputMode="decimal"
                    aria-label={`Amount to ${mode}`}
                    className="tnum mvinput"
                    style={{ flex: 1, minWidth: 150, height: 40, padding: "0 14px", borderRadius: 6, border: `1px solid ${localError ? "var(--neg)" : "var(--line)"}`, background: "var(--panel-2)", color: "var(--ink)", fontSize: 15, fontWeight: 600 }}
                  />
                  <button className="mvbtn mvbtn-primary" style={btn("primary")} disabled={s.busy !== null} onClick={() => guard(mode)}>
                    {s.busy === mode ? (mode === "stake" ? "Staking…" : "Requesting…") : (mode === "stake" ? "Stake" : "Unstake")}
                  </button>
                </div>

                {/* Quick amounts for the active tab, spanning the full input width:
                    % of wallet to stake, % of your stake to unstake. */}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {[25, 50, 75, 100].map((p) => pctChip(p, snap ? (mode === "stake" ? snap.wallet : snap.staked) : BigInt(0)))}
                </div>

                {((snap && snap.pending > BigInt(0)) || STAKING_TESTNET) && (
                  <div style={{ display: "flex", gap: 7, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {snap && snap.pending > BigInt(0) && (
                      <>
                        <button className="mvbtn mvbtn-quiet" onClick={() => setPlan(plans.cancel())} disabled={s.busy !== null} style={chip}>
                          {s.busy === "cancel" ? "Cancelling…" : "Cancel unstake"}
                        </button>
                        <button
                          className={unlockPassed ? "mvbtn mvbtn-primary" : "mvbtn mvbtn-quiet"}
                          onClick={() => setPlan(plans.withdraw())}
                          disabled={!unlockPassed || s.busy !== null}
                          title={unlockPassed ? undefined : "Still cooling down"}
                          style={unlockPassed
                            ? { ...chip, background: "var(--primary)", color: "var(--primary-ink)", borderColor: "transparent", fontWeight: 700 }
                            : { ...chip, color: "var(--ink-3)" }}
                        >
                          {s.busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
                        </button>
                      </>
                    )}
                    {STAKING_TESTNET && (
                      <button className="mvbtn mvbtn-quiet" onClick={() => setPlan(plans.mint())} disabled={s.busy !== null} style={{ ...chip, marginLeft: "auto", borderStyle: "dashed" }}>
                        {s.busy === "mint" ? "Minting…" : "Get test tokens"}
                      </button>
                    )}
                  </div>
                )}

                {s.step && (
                  <div style={{ marginTop: 12, padding: "10px 13px", borderRadius: 6, background: "var(--panel-2)", fontSize: 13, color: "var(--ink-2)", display: "flex", gap: 9, alignItems: "center" }}>
                    <span className="mvspin" style={{ width: 12, height: 12, flex: "none", borderRadius: 99, border: "2px solid color-mix(in srgb, var(--primary) 30%, transparent)", borderTopColor: "var(--primary)" }} />
                    <span style={{ flex: 1 }}>{s.step}</span>
                    {!wallet.silentSigning && s.step.startsWith("Waiting") && (
                      <span style={meta}>check your wallet</span>
                    )}
                  </div>
                )}

                {(localError || s.error) && (
                  <div role="alert" style={{ marginTop: 12, padding: "10px 13px", borderRadius: 6, background: "color-mix(in srgb, var(--neg) 8%, transparent)", color: "var(--neg)", fontSize: 13, display: "flex", gap: 9, alignItems: "center" }}>
                    <PIcon name="ph-warning-circle" size={15} weight="fill" />
                    <span style={{ flex: 1 }}>{localError ?? s.error}</span>
                    <button className="mvbtn" onClick={() => { setLocalError(null); s.clearError(); }} aria-label="Dismiss" style={{ background: "none", border: "none", padding: 2 }}>
                      <PIcon name="ph-x" size={13} weight="bold" />
                    </button>
                  </div>
                )}
              </div>

              {/* your season — fills the space to the footer with real facts, not air */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "14px 18px", borderTop: "1px solid var(--line)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Your season</div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Curator rights</span>
                  <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: curatorEligible ? "var(--primary)" : "var(--ink)" }}>
                    {curatorEligible ? "Eligible" : `${num(Math.max(0, CURATOR_GATE - stakedNum))} to go`}
                  </span>
                </div>
                <Link
                  href="/groves"
                  className="mvlink"
                  style={{ marginTop: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--primary)", textDecoration: "none" }}
                >
                  Curate a Grove <PIcon name="ph-arrow-right" size={12} weight="bold" />
                </Link>
              </div>

              <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.6 }}>
                {cooldownLabel} unstake cooldown{STAKING_TESTNET ? " on testnet" : ""}. Cooling stake does not earn. {num(CURATOR_GATE)}+ staked unlocks curator rights. One epoch = 24h; your share is credited when each epoch closes and only ever goes up, paid from the team&apos;s own allocation. Rewards vary with total stake and are claimable at season close.
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── leaderboard ── */}
      <section style={sec}>
        <SectionHead
          title="Leaderboard"
          right={
            <span style={meta}>
              {snap ? `${snap.leaderboard.length} staker${snap.leaderboard.length === 1 ? "" : "s"} · live from chain` : "loading…"}
            </span>
          }
        />
        <div style={{ ...panel, minWidth: 0 }}>
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <table className="mvs-tb" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 300 }}>
              <thead>
                <tr>
                  {["#", "Address", "Staked", "Earned"].map((h, i) => (
                    <th
                      key={h}
                      className={i === 0 ? "mvs-rank" : undefined}
                      style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)", textAlign: i < 2 ? "left" : "right", padding: "11px 18px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Always render a full page of PAGE_SIZE slots: real stakers fill
                    the top, empty placeholders hold the rest so the box keeps a
                    steady height. Pagination controls arrive with the endpoint. */}
                {Array.from({ length: LEADERBOARD_PAGE }).map((_, i) => {
                  const r = snap?.leaderboard[i];
                  if (r) {
                    const me = wallet.address && r.address.toLowerCase() === wallet.address.toLowerCase();
                    return (
                      <tr key={r.address} className={me ? undefined : "mvrow"} style={{ background: me ? "color-mix(in srgb, var(--primary) 6%, transparent)" : "transparent" }}>
                        <td className="mvs-rank" style={{ ...cell, color: "var(--ink-3)", fontSize: 12 }}>{i + 1}</td>
                        <td className="tnum" style={{ ...cell, fontSize: 12.5, whiteSpace: "nowrap" }}>
                          {short(r.address)}
                          {me && <span style={{ ...tag(), marginLeft: 8 }}>You</span>}
                        </td>
                        <td className="tnum" style={{ ...cell, textAlign: "right", fontWeight: 650, whiteSpace: "nowrap" }}>{fmt(r.staked)}</td>
                        <td className="tnum" style={{ ...cell, textAlign: "right", fontWeight: 650, whiteSpace: "nowrap", color: r.earned !== undefined && r.earned > BigInt(0) ? "var(--primary)" : "var(--ink-3)" }}>
                          {r.earned !== undefined ? fmt(r.earned) : "—"}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={`ph-${i}`} style={{ opacity: 0.4 }}>
                      <td className="mvs-rank" style={{ ...cell, color: "var(--ink-3)", fontSize: 12 }}>{i + 1}</td>
                      <td style={{ ...cell, color: "var(--ink-3)", fontSize: 12.5 }}>—</td>
                      <td style={{ ...cell, textAlign: "right", color: "var(--ink-3)" }}>—</td>
                      <td style={{ ...cell, textAlign: "right", color: "var(--ink-3)" }}>—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      </div>

      {/* ── faq ── */}
      <section style={sec}>
        <SectionHead title="FAQ" />
        <div style={panel}>
          {FAQ_ITEMS.map(({ q, a }) => (
            <details className="mvfq" key={q}>
              <summary>
                {q}
                <span className="mvcaret"><PIcon name="ph-caret-right" size={14} weight="bold" /></span>
              </summary>
              <div className="mvans">{a}</div>
            </details>
          ))}
        </div>
      </section>

      {plan && <ConfirmDialog plan={plan} wallet={wallet} onClose={() => setPlan(null)} />}
    </div>
  );
}
