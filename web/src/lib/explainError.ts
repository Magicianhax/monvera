// Plain-English failure reasons, in one place.
//
// Users were shown "The investment didn't go through" / "Something went wrong"
// with no cause, while the real reason (gas sponsorship out of funds, an
// expired quote, a declined signature) sat in the console. If we can name what
// happened, we say it — and we always say what it means for their money,
// because that is the first thing anyone wants to know.
//
// Rules for anything added here:
//  - Plain words. No error codes, no "InvalidAction()", no stack fragments.
//  - Say what to do next when there is something to do.
//  - Never imply money moved when it didn't, and never promise it didn't when
//    we cannot tell.

interface Rule {
  match: RegExp;
  say: string;
}

/** True when the user themselves declined the wallet prompt. Batch flows must
 *  treat this as "stop the whole run", never as a transient venue failure —
 *  retrying re-prompts the person who just said no, over and over. */
export function isUserRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rejected|denied|user (cancelled|canceled)|signature.*(declin|reject)/i.test(msg);
}

// Order matters: first match wins, so put specific patterns above general ones.
const RULES: Rule[] = [
  {
    // Pimlico paymaster out of balance / sponsorship policy rejection.
    match: /paymaster|sponsor|aa2[0-9]|gas sponsor|insufficient (funds|balance) (for|in) (the )?paymaster|policy/i,
    say: "Gas sponsorship is temporarily unavailable, so the transaction couldn't be submitted. Nothing left your wallet — this is on our side and usually clears within minutes.",
  },
  {
    match: /rejected|denied|user (cancelled|canceled)|signature.*(declin|reject)/i,
    say: "The signature was declined, so nothing was placed. Your money hasn't moved.",
  },
  {
    match: /no liquidity|liquidityAvailable|no route|no available quotes|cannot be filled/i,
    say: "No trading venue could fill this right now — that happens when maker inventory dries up. Nothing was placed, and it usually comes back within minutes.",
  },
  {
    match: /expired|stale quote|deadline/i,
    say: "The quoted price expired before it could be placed, so nothing went through. Prices move fast here — try again and you'll get a fresh quote.",
  },
  {
    match: /insufficient (funds|balance)|exceeds balance|transfer amount exceeds/i,
    say: "There wasn't enough balance to cover this. Nothing was placed.",
  },
  {
    match: /429|rate limit|too many requests/i,
    say: "The trading venues are busy right now and asked us to slow down. Nothing was placed — try again in a moment.",
  },
  {
    match: /timeout|timed out|abort/i,
    say: "The network took too long to answer, so this was stopped before anything was placed.",
  },
  {
    match: /revert|InvalidAction|execution reverted/i,
    say: "The trade was rejected by the venue's contract when it ran, so nothing was placed. Retrying usually routes it through a different venue.",
  },
  {
    match: /network|fetch failed|failed to fetch|offline|ERR_/i,
    say: "The connection dropped before this could be placed. Nothing moved — check your connection and try again.",
  },
];

/** One plain sentence for any raw error. Falls back to an honest unknown. */
export function explainError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  // Already-friendly messages (our own thrown copy) pass through untouched.
  if (/^[A-Z][^{}\n]{20,}[.!?]$/.test(msg.trim()) && !/0x[0-9a-f]{8}/i.test(msg)) return msg.trim();
  for (const r of RULES) if (r.match.test(msg)) return r.say;
  return "That didn't go through, and nothing left your wallet. I couldn't tell exactly why — trying again usually clears it.";
}

/** Why a whole invest failed, from the per-leg reasons it collected. */
export function explainInvestFailure(failures: { symbol: string; message: string }[]): string {
  if (failures.length === 0) {
    return "The investment didn't go through and no funds were moved. I couldn't tell exactly why — try again in a moment.";
  }
  // One shared cause is the common case (gas sponsorship, venues busy): say it
  // once rather than repeating it per stock.
  const reasons = [...new Set(failures.map((f) => explainError(f.message)))];
  if (reasons.length === 1) return `Nothing was bought — no funds left your wallet. ${reasons[0]}`;
  const named = failures
    .slice(0, 3)
    .map((f) => `${f.symbol}: ${explainError(f.message)}`)
    .join(" ");
  return `Nothing was bought — no funds left your wallet. ${named}`;
}
