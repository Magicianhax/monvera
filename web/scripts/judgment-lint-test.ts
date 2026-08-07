// Correctness test for the verdict lint — the last gate before model prose is
// shown verbatim to a holder whose money just moved. No chain, no model, no
// network: fixed strings only.
//
//   npx tsx --conditions=react-server scripts/judgment-lint-test.ts
//
// What this has to prove: a reason may only quote numbers the model was ACTUALLY
// GIVEN. The old check was `/\d/.test(reason)` — it asked whether a digit was
// present, not whether it was true, so a confident invented figure wearing a real
// ticker passed and was displayed as fact. Honest rounding must still survive, or
// the lint fails good sentences into the neutral fallback and users learn nothing.
import { lintVerdictReason, ourVerdict, displayReason } from "../src/lib/server/rebalanceJudgment";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${name} ${extra}`);
  }
}

const SYMBOLS = ["NVDA", "QQQ", "GOOGL", "TSLA"];
// What a real brief renders: weights, targets, deviations, day moves, turnover.
const FIGURES = [16.3, 14.0, 2.3, 3.4, 8.8, 11.0, 2.2, 20, 1.9, 24];

console.log("- grounded reasons pass");
ok("quotes a real weight and a real symbol", lintVerdictReason("NVDA sits at 16.3% against a 14.0% target, so the plan trims it.", SYMBOLS, FIGURES));
ok("quotes a day move", lintVerdictReason("QQQ moved 3.4% today, an ordinary session for it.", SYMBOLS, FIGURES));
ok("quotes turnover", lintVerdictReason("About 20 of turnover in GOOGL and TSLA, all within the usual band.", SYMBOLS, FIGURES));

console.log("- honest rounding survives");
ok("2.25 written as 2.3 (rendered value)", lintVerdictReason("TSLA is 2.3 points under its target.", SYMBOLS, FIGURES));
ok("16.3 written as 16.2 (within tolerance)", lintVerdictReason("NVDA at 16.2% is the largest overweight.", SYMBOLS, FIGURES));
ok("14.0 written as 14", lintVerdictReason("NVDA's target is 14%.", SYMBOLS, FIGURES));

console.log("- INVENTED figures are rejected (the point of this test)");
ok("a plausible number never shown", !lintVerdictReason("NVDA is up 7.8% today, so waiting is wiser.", SYMBOLS, FIGURES));
ok("a real figure plus an invented one", !lintVerdictReason("NVDA at 16.3% has run 42% this quarter.", SYMBOLS, FIGURES));
ok("invented dollar amount", !lintVerdictReason("The plan moves $137 across NVDA and QQQ.", SYMBOLS, FIGURES));
ok("far-off number outside tolerance", !lintVerdictReason("GOOGL is 9.4% of the basket.", SYMBOLS, FIGURES));

console.log("- the original checks still hold");
ok("no numeral at all", !lintVerdictReason("NVDA drifted a little, so the basket was realigned.", SYMBOLS, FIGURES));
ok("no brief symbol named", !lintVerdictReason("One holding sits at 16.3% against a 14.0% target.", SYMBOLS, FIGURES));
ok("forward-looking claim", !lintVerdictReason("NVDA at 16.3% will keep climbing from here.", SYMBOLS, FIGURES));

console.log("- empty brief cannot be quoted");
ok("no figures available -> nothing is groundable", !lintVerdictReason("NVDA is at 16.3%.", SYMBOLS, []));

console.log("- our own sentences are never linted");
{
  const v = ourVerdict("proceed", "This basket has waited 3 windows for a calmer market, so it is being realigned now rather than drifting further.");
  ok("ourVerdict is lintOk by construction", v.lintOk === true);
  ok("and is therefore shown verbatim", displayReason(v) === v.reason);
  // The sentence names no ticker and its "3" is not a brief figure, so the model
  // lint would reject it — which is precisely why it must not be applied.
  ok("the model lint WOULD have rejected it", !lintVerdictReason(v.reason, SYMBOLS, FIGURES));
  ok("source override is honoured", ourVerdict("proceed", "x", "model").source === "model");
  ok("source defaults to outage", ourVerdict("defer", "x").source === "outage");
}

console.log("- a failing model reason degrades to a claimless sentence");
{
  const bad = { action: "proceed" as const, reason: "NVDA is up 7.8% today.", source: "model" as const, lintOk: false };
  ok("displayReason substitutes", displayReason(bad) !== bad.reason);
  ok("substitute cites no figure", !/\d/.test(displayReason(bad)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
