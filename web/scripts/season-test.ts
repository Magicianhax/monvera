// Correctness test for the season computation. No chain, hand-checkable numbers.
//   npx tsx scripts/season-test.ts
import {
  replayBalances, dailyPools, integrate, distribute, buildSeason,
  previewFor, leafOf, verifyProof, finishedDays, weightUpTo, SECONDS_PER_DAY, type StakeEvent, type SeasonParams,
} from "../src/lib/season/compute";

let pass = 0, fail = 0;
const E18 = BigInt(10) ** BigInt(18);
function ok(name: string, cond: boolean, extra = "") { if (cond) { pass++; } else { fail++; console.error(`  FAIL ${name} ${extra}`); } }
function eq(name: string, got: bigint, want: bigint) { ok(name, got === want, `got ${got} want ${want}`); }

const A = "0x000000000000000000000000000000000000000a" as const;
const B = "0x000000000000000000000000000000000000000b" as const;
const START = BigInt(1_000_000); // arbitrary UTC day-0

const P = (over: Partial<SeasonParams> = {}): SeasonParams => ({
  seasonId: BigInt(0), seasonStart: START, days: 3, pool: BigInt(900) * E18, exclude: new Set(), ...over,
});

// 1. Withdrawn is a no-op for staked balance.
{
  const ev: StakeEvent[] = [
    { kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
    { kind: "UnstakeRequested", user: A, amount: BigInt(40), ts: START + BigInt(10) },
    { kind: "Withdrawn", user: A, amount: BigInt(40), ts: START + BigInt(100) },
  ];
  const tl = replayBalances(ev).get(A)!;
  eq("withdraw-noop final balance", tl[tl.length - 1].bal, BigInt(60));
}

// 2. dailyPools sum to exactly pool, remainder on last day.
{
  const pools = dailyPools(BigInt(2_000_000) * E18, 90);
  const sum = pools.reduce((s, x) => s + x, BigInt(0));
  eq("dailyPools sum == pool", sum, BigInt(2_000_000) * E18);
  ok("dailyPools last carries remainder", pools[89] >= pools[0]);
}

// 3. Two equal stakers held the whole 3-day season split the pool 50/50.
{
  const p = P();
  const ev: StakeEvent[] = [
    { kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
    { kind: "Staked", user: B, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
  ];
  const tls = replayBalances(ev);
  const { perWallet, totals } = integrate(tls, p, START + BigInt(3) * SECONDS_PER_DAY);
  const rew = distribute(perWallet, totals, dailyPools(p.pool, p.days), 3);
  eq("equal A", rew.get(A)!, BigInt(450) * E18);
  eq("equal B", rew.get(B)!, BigInt(450) * E18);
}

// 4. Late whale cannot touch a finished day. A holds days 0-2; B stakes 10x on day 2 only.
//    Day 0 and day 1 are 100% A. Day 2 splits by that day's stake-time.
{
  const p = P();
  const ev: StakeEvent[] = [
    { kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
    { kind: "Staked", user: B, amount: BigInt(1000), stakedAfter: BigInt(1000), ts: START + BigInt(2) * SECONDS_PER_DAY },
  ];
  const tls = replayBalances(ev);
  const { perWallet, totals } = integrate(tls, p, START + BigInt(3) * SECONDS_PER_DAY);
  const rew = distribute(perWallet, totals, dailyPools(p.pool, p.days), 3);
  // Days 0,1: 300 each fully to A = 600. Day 2: 300 split 100:1000 -> A gets 300*100/1100.
  const day2A = (BigInt(300) * E18 * BigInt(100)) / BigInt(1100);
  const day2B = (BigInt(300) * E18 * BigInt(1000)) / BigInt(1100);
  eq("whale day0+1 all A", rew.get(A)! - day2A, BigInt(600) * E18);
  eq("whale day2 A share", (rew.get(A)! - BigInt(600) * E18), day2A);
  eq("whale day2 B share", rew.get(B)!, day2B);
  ok("whale got < 1/3 of pool", rew.get(B)! < BigInt(300) * E18);
}

// 5. bankedSoFar is monotone: adding a late staker never lowers A's banked for finished days.
{
  const p = P();
  const evEarly: StakeEvent[] = [{ kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START }];
  const bankedBefore = previewFor(evEarly, p, START + BigInt(2) * SECONDS_PER_DAY + BigInt(1), A).bankedSoFar; // 2 finished days
  const evLate: StakeEvent[] = [
    ...evEarly,
    { kind: "Staked", user: B, amount: BigInt(100), stakedAfter: BigInt(100), ts: START + BigInt(2) * SECONDS_PER_DAY + BigInt(100) },
  ];
  const bankedAfter = previewFor(evLate, p, START + BigInt(2) * SECONDS_PER_DAY + BigInt(200), A).bankedSoFar;
  ok("banked monotone (late staker on day2 doesn't cut A's days 0-1)", bankedAfter >= bankedBefore, `before ${bankedBefore} after ${bankedAfter}`);
  eq("A banked 2 finished days alone", bankedBefore, BigInt(600) * E18);
}

// 6. No cap: a big staker earns strictly in proportion, uncapped. A holds 9x B all season.
{
  const p = P();
  const ev: StakeEvent[] = [
    { kind: "Staked", user: A, amount: BigInt(900), stakedAfter: BigInt(900), ts: START },
    { kind: "Staked", user: B, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
  ];
  const tls = replayBalances(ev);
  const { perWallet, totals } = integrate(tls, p, START + BigInt(3) * SECONDS_PER_DAY);
  const rew = distribute(perWallet, totals, dailyPools(p.pool, p.days), 3);
  eq("uncapped A gets 90% (900/1000)", rew.get(A)!, BigInt(810) * E18);
  eq("uncapped B gets 10%", rew.get(B)!, BigInt(90) * E18);
}

// 7. Empty day rolls forward.
{
  const p = P();
  // A stakes only on day 1 (day 0 has nobody). Day 0's bucket should roll into day 1.
  const ev: StakeEvent[] = [{ kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START + SECONDS_PER_DAY }];
  const tls = replayBalances(ev);
  const { perWallet, totals } = integrate(tls, p, START + BigInt(3) * SECONDS_PER_DAY);
  const rew = distribute(perWallet, totals, dailyPools(p.pool, p.days), 3);
  // Day0 empty -> rolls into day1. A holds days 1,2 alone => gets day0+day1+day2 = whole pool.
  eq("empty day rolled forward to sole staker", rew.get(A)!, BigInt(900) * E18);
}

// 8. Excluded (sybil) wallet earns nothing and does not absorb pool.
{
  const p = P({ exclude: new Set([B.toLowerCase()]) });
  const ev: StakeEvent[] = [
    { kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
    { kind: "Staked", user: B, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
  ];
  const tls = replayBalances(ev);
  const { perWallet, totals } = integrate(tls, p, START + BigInt(3) * SECONDS_PER_DAY);
  const rew = distribute(perWallet, totals, dailyPools(p.pool, p.days), 3);
  eq("excluded B gets nothing", rew.get(B.toLowerCase()) ?? BigInt(0), BigInt(0));
  eq("A gets full pool (B excluded from denom)", rew.get(A)!, BigInt(900) * E18);
}

// 9. Merkle: every leaf's proof verifies against the root, at odd sizes.
for (const n of [1, 2, 3, 7]) {
  const ev: StakeEvent[] = [];
  for (let i = 0; i < n; i++) {
    const addr = ("0x" + (i + 1).toString(16).padStart(40, "0")) as `0x${string}`;
    ev.push({ kind: "Staked", user: addr, amount: BigInt(i + 1) * BigInt(100), stakedAfter: BigInt(i + 1) * BigInt(100), ts: START });
  }
  const res = buildSeason(ev, P({ days: 1, pool: BigInt(900) * E18 }));
  let allOk = res.leaves.length === n;
  for (const { account, amount } of res.leaves) {
    if (!verifyProof(leafOf(BigInt(0), account, amount), res.proofs[account.toLowerCase()], res.root)) allOk = false;
  }
  ok(`merkle proofs verify at n=${n}`, allOk);
  ok(`sum(leaves) <= pool at n=${n}`, res.totalDistributed <= BigInt(900) * E18);
}

// 10. finishedDays boundary.
{
  const p = P({ days: 90 });
  eq("finishedDays at start", BigInt(finishedDays(p, START)), BigInt(0));
  eq("finishedDays mid-day-0", BigInt(finishedDays(p, START + BigInt(100))), BigInt(0));
  eq("finishedDays start of day1", BigInt(finishedDays(p, START + SECONDS_PER_DAY)), BigInt(1));
  eq("finishedDays past end clamps", BigInt(finishedDays(p, START + BigInt(200) * SECONDS_PER_DAY)), BigInt(90));
}

// 11. weightUpTo matches the on-chain accumulator and stays nonzero for a wallet
//     that has FULLY exited — the case the reconciliation gate must catch.
{
  const ev: StakeEvent[] = [
    { kind: "Staked", user: A, amount: BigInt(100), stakedAfter: BigInt(100), ts: START },
    { kind: "UnstakeRequested", user: A, amount: BigInt(40), ts: START + BigInt(10) },
    { kind: "UnstakeRequested", user: A, amount: BigInt(60), ts: START + BigInt(20) }, // now fully out
  ];
  const tl = replayBalances(ev).get(A)!;
  eq("weightUpTo integrates Σ bal×seconds", weightUpTo(tl, START + BigInt(30)), BigInt(100) * BigInt(10) + BigInt(60) * BigInt(10));
  eq("fully-exited wallet has 0 final balance", tl[tl.length - 1].bal, BigInt(0));
  ok("…but nonzero weight (why the gate reconciles totalWeight, not just totalStaked)", weightUpTo(tl, START + BigInt(30)) > BigInt(0));
  // Weight stops growing once the balance is 0.
  eq("weight flat after full exit", weightUpTo(tl, START + BigInt(30)), weightUpTo(tl, START + BigInt(999)));
}

console.log(`\nseason-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
