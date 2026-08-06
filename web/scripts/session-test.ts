// Correctness test for the reference-session hint fed to Vera's timing
// judgment. No chain, no model, no network: fixed instants only.
//
//   npx tsx --conditions=react-server scripts/session-test.ts
//
// What this has to prove: the five cron windows are classified correctly on
// both sides of DST, and weekends are closed. It matters because on 2026-08-05
// Vera deferred three windows running against a frozen tape — calling settled
// closes "a live move" — and only the defer-streak cap rescued the basket. The
// hint is what stops her reasoning from a premise that is false three windows
// out of five.
//
// This function gates NOTHING. It only shapes a prompt line; execution timing
// is the oracle's freshness check alone (see feedFresh in autoRebalance.ts).
import { referenceSessionOpen } from "../src/lib/server/rebalanceJudgment";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${name} ${extra}`);
  }
}
const at = (iso: string) => referenceSessionOpen(new Date(iso));

// --- The five daily cron windows, summer (EDT, UTC-4) ----------------------
// Session is 13:30–20:00 UTC in EDT. 2026-08-06 is a Thursday.
console.log("- cron windows, EDT (session 13:30-20:00 UTC)");
ok("00:00 UTC closed", at("2026-08-06T00:00:00Z") === false);
ok("06:00 UTC closed", at("2026-08-06T06:00:00Z") === false);
ok("12:00 UTC closed", at("2026-08-06T12:00:00Z") === false);
ok("13:30 UTC open (the open itself)", at("2026-08-06T13:30:00Z") === true);
ok("18:00 UTC open", at("2026-08-06T18:00:00Z") === true);

// --- Boundaries ------------------------------------------------------------
console.log("- boundaries");
ok("13:29 UTC still closed", at("2026-08-06T13:29:00Z") === false);
ok("19:59 UTC still open", at("2026-08-06T19:59:00Z") === true);
ok("20:00 UTC closed (the close is exclusive)", at("2026-08-06T20:00:00Z") === false);

// --- Winter (EST, UTC-5): the same clock times shift an hour ---------------
// Session is 14:30–21:00 UTC in EST. 2026-01-15 is a Thursday. If this ever
// fails while the EDT block passes, someone replaced Intl with a fixed offset.
console.log("- cron windows, EST (session 14:30-21:00 UTC)");
ok("13:30 UTC closed in winter", at("2026-01-15T13:30:00Z") === false);
ok("14:30 UTC open in winter", at("2026-01-15T14:30:00Z") === true);
ok("18:00 UTC open in winter", at("2026-01-15T18:00:00Z") === true);
ok("20:30 UTC open in winter", at("2026-01-15T20:30:00Z") === true);
ok("21:00 UTC closed in winter", at("2026-01-15T21:00:00Z") === false);

// --- Weekends --------------------------------------------------------------
// 2026-08-08 is a Saturday, 2026-08-09 a Sunday. Mid-session clock time, so
// only the weekday check can be what closes these.
console.log("- weekends");
ok("Saturday 18:00 UTC closed", at("2026-08-08T18:00:00Z") === false);
ok("Sunday 18:00 UTC closed", at("2026-08-09T18:00:00Z") === false);
ok("Monday 18:00 UTC open", at("2026-08-10T18:00:00Z") === true);
ok("Friday 18:00 UTC open", at("2026-08-07T18:00:00Z") === true);

// --- Midnight folding ------------------------------------------------------
// hour12:false renders midnight as "24" in some ICU builds; if the fold were
// dropped, 04:00 UTC (= 00:00 New York) would compute 1440 minutes and read as
// open. Closed either way, but this pins the arithmetic.
console.log("- midnight");
ok("04:00 UTC (midnight New York) closed", at("2026-08-06T04:00:00Z") === false);
ok("05:00 UTC (01:00 New York) closed", at("2026-08-06T05:00:00Z") === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
