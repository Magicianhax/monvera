// Correctness test for the news sweep's pure logic. No chain, no model, no
// network — hand-checkable fixtures only.
//   npx tsx --conditions=react-server scripts/news-test.ts
//
// The condition flag is required, not optional: the modules under test carry
// `import "server-only"`, whose package throws under the default condition and
// resolves to an empty stub under "react-server" — exactly how Next resolves it
// on the server. Without it the script dies before the first assertion.
import { parseYahooRss, parseGoogleRss } from "../src/lib/server/newsFeed";
import { hasForwardLooking, namesSymbol, normalizeCopy, PREDICTIVE_TITLE } from "../src/lib/server/copyLint";
import { isRelevant } from "../src/lib/server/newsAlerts";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${name} ${extra}`);
  }
}
function group(name: string) {
  console.log(`- ${name}`);
}

// ── fixture ───────────────────────────────────────────────────────────────────
function item(over: { title?: string; desc?: string; link?: string; date?: string; guid?: string } = {}) {
  return [
    "<item>",
    `<title>${over.title ?? "Nvidia said something"}</title>`,
    `<link>${over.link ?? "https://finance.yahoo.com/news/x.html"}</link>`,
    `<pubDate>${over.date ?? "Sun, 03 Aug 2026 23:24:12 +0000"}</pubDate>`,
    `<guid isPermaLink="false">${over.guid ?? "uuid-x"}</guid>`,
    `<description>${over.desc ?? "A plain summary."}</description>`,
    "</item>",
  ].join("");
}
function feed(items: string[]) {
  return `<rss version="2.0"><channel><title>Yahoo! Finance: NVDA News</title><link>https://finance.yahoo.com/</link>${items.join("")}</channel></rss>`;
}

group("parser");
{
  const twenty = feed(Array.from({ length: 20 }, (_, i) => item({ guid: `uuid-${i}`, title: `Story ${i}` })));
  const parsed = parseYahooRss(twenty, "NVDA");
  ok("20 items parsed", parsed.length === 20, `got ${parsed.length}`);
  ok("per-item title, not the channel title", parsed[0].title === "Story 0", parsed[0].title);
  ok("guid captured", parsed[3].guid === "uuid-3", parsed[3].guid);
  ok("publisher from hostname", parsed[0].publisher === "Yahoo Finance", parsed[0].publisher);
  ok("publishedAt is epoch ms", parsed[0].publishedAt === Date.parse("Sun, 03 Aug 2026 23:24:12 +0000"));
}
{
  // Entity ORDER: &amp;lt; must stay literal text, never become markup.
  const parsed = parseYahooRss(feed([item({ desc: "&amp;lt;body&amp;gt;STORY: real text here" })]), "NVDA");
  ok("escaped markup stays literal", parsed[0].summary.includes("&lt;body&gt;"), parsed[0].summary);
  ok("no tag resurrected", !parsed[0].summary.includes("<body>"), parsed[0].summary);
}
{
  // Real markup in the description IS stripped after decoding.
  const parsed = parseYahooRss(feed([item({ desc: "&lt;p&gt;STORY: stripped&lt;/p&gt;" })]), "NVDA");
  ok("decoded markup stripped", parsed[0].summary === "STORY: stripped", parsed[0].summary);
}
{
  const parsed = parseYahooRss(feed([item({ title: "Nvidia&#8217;s quarter" })]), "NVDA");
  ok("numeric entity decoded", parsed[0].title === "Nvidia’s quarter", parsed[0].title);
}
{
  const cdata = feed([item({ title: "<![CDATA[Nvidia & the fab]]>" })]);
  ok("CDATA title unwrapped", parseYahooRss(cdata, "NVDA")[0].title === "Nvidia & the fab");
}
{
  const bad = feed([item({ date: "not a date" }), item({ guid: "good" })]);
  const parsed = parseYahooRss(bad, "NVDA");
  ok("unparseable pubDate dropped", parsed.length === 1 && parsed[0].guid === "good", `got ${parsed.length}`);
}
{
  const empty = `<rss><channel><title>Yahoo! Finance:  News</title></channel></rss>`;
  ok("zero items is [] not an error", parseYahooRss(empty, "ZZZZQQ").length === 0);
}
{
  // Google shape: "Headline - Publisher", <source>, relevance order.
  const g = [
    "<item><title>Nvidia - The Big Deal - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link>",
    "<pubDate>Sat, 01 Aug 2026 20:31:00 GMT</pubDate><guid isPermaLink=\"false\">g1</guid>",
    "<description>&lt;a href=\"x\"&gt;Nvidia&lt;/a&gt;</description><source url=\"https://reuters.com\">Reuters</source></item>",
    "<item><title>Later story - CNBC</title><link>https://news.google.com/rss/articles/def?oc=5</link>",
    "<pubDate>Mon, 03 Aug 2026 20:31:00 GMT</pubDate><guid isPermaLink=\"false\">g2</guid>",
    "<description>x</description><source url=\"https://cnbc.com\">CNBC</source></item>",
  ].join("");
  const parsed = parseGoogleRss(`<rss><channel>${g}</channel></rss>`, "NVDA");
  ok("google sorted newest-first", parsed[0].guid === "g2", parsed[0].guid);
  ok("google splits on the LAST ' - '", parsed[1].title === "Nvidia - The Big Deal", parsed[1].title);
  ok("google publisher from <source>", parsed[1].publisher === "Reuters", parsed[1].publisher);
  ok("google description discarded", parsed[1].summary === "", parsed[1].summary);
}

group("relevance gate");
{
  const rel = (title: string, sym: string, summary = "") => isRelevant({ title, summary }, sym);
  ok("off-topic NVDA-feed item rejected", !rel("SanDisk stock jumps on memory pricing", "NVDA"));
  ok("company name accepted", rel("Nvidia said it suspended licences", "NVDA"));
  ok("(P) parenthesized form accepted", rel("Everpure (P) And The AI Infrastructure Narrative", "P"));
  ok("bare capital P rejected", !rel("The company said P was a placeholder in its filing", "P"));
  ok("GOOGL via alias", rel("Google unveils a new TPU generation", "GOOGL"));
  ok("META via alias", rel("Facebook parent restructures its ads unit", "META"));
  ok("$TICKER form accepted", rel("Traders piled into $RBLX after the print", "RBLX"));
  ok("bare long ticker accepted", rel("RBLX reported bookings", "RBLX"));
  ok("lowercase ticker not a match", !rel("the rblx crowd is loud", "RBLX"));
}

group("predictive title rejection");
{
  const rejects = (t: string) => PREDICTIVE_TITLE.some((p) => p.test(t));
  ok("AI predicts", rejects("AI predicts NVDA price for August 31"));
  ok("price target", rejects("Analyst lifts price target on AAPL"));
  ok("could hit", rejects("This stock could hit $500"));
  ok("where will it be", rejects("Where Will Nvidia Stock Be In 5 Years?"));
  ok("is it a buy", rejects("Nvidia: Is It A Buy After Earnings?"));
  ok("plain event survives", !rejects("Nvidia disclosed a suspension of its export licences"));
}

group("copy lint");
{
  ok("em dash to comma", normalizeCopy("Nvidia — the chip maker — disclosed a filing").indexOf("—") === -1);
  ok("en dash to comma", normalizeCopy("A – B") === "A, B", normalizeCopy("A – B"));
  ok("curly apostrophe straightened", normalizeCopy("Nvidia’s filing") === "Nvidia's filing");
  ok("curly quotes straightened", normalizeCopy("“filed”") === '"filed"');
  ok("nbsp collapsed", normalizeCopy("a  b") === "a b");
  ok("leading dash dropped", normalizeCopy("— Nvidia filed") === "Nvidia filed");
  ok("forward-looking: will", hasForwardLooking("NVDA will recover"));
  ok("forward-looking: price target", hasForwardLooking("NVDA hit its price target"));
  ok("forward-looking: expected", hasForwardLooking("NVDA is expected to rise"));
  ok("past tense passes", !hasForwardLooking("NVDA disclosed a licence suspension."));
  ok("line names its symbol", namesSymbol("NVDA disclosed a licence suspension.", ["NVDA"]));
  ok("line omitting its symbol fails", !namesSymbol("The company disclosed a suspension.", ["NVDA"]));
}

group("anti-spam arithmetic");
{
  // Mirrors the sweep's gate order: exposure floor, per-(user,symbol) cooldown,
  // per-user daily cap. Same constants as newsAlerts.
  const MIN_EXPOSURE_USD = 5;
  const USER_DAILY_CAP = 3;
  const holders = [
    { userId: "u1", eoaUsd: 340, smartUsd: 0 },
    { userId: "u2", eoaUsd: 0, smartUsd: 18 },
    { userId: "u3", eoaUsd: 4.99, smartUsd: 0 }, // under the floor
    { userId: "u4", eoaUsd: 60, smartUsd: 0 }, // already told about this symbol
    { userId: "u5", eoaUsd: 60, smartUsd: 0 }, // at the daily cap
  ];
  const alreadyThisSymbol = new Set(["u4"]);
  const countsToday = new Map([["u5", 3]]);
  const skipped = { exposure: 0, cooldown: 0, cap: 0 };
  const sent: string[] = [];
  for (const h of holders) {
    if (h.eoaUsd + h.smartUsd < MIN_EXPOSURE_USD) {
      skipped.exposure++;
      continue;
    }
    if (alreadyThisSymbol.has(h.userId)) {
      skipped.cooldown++;
      continue;
    }
    if ((countsToday.get(h.userId) ?? 0) >= USER_DAILY_CAP) {
      skipped.cap++;
      continue;
    }
    sent.push(h.userId);
  }
  ok("only u1 and u2 receive", sent.join(",") === "u1,u2", sent.join(","));
  ok("one dropped by exposure", skipped.exposure === 1);
  ok("one dropped by cooldown", skipped.cooldown === 1);
  ok("one dropped by cap", skipped.cap === 1);
}

group("copy composition");
{
  // The shipped strings, assembled the way composeBody does.
  const CLOSER = "Vera does not trade on news, so the call is yours.";
  const eoa = `Nvidia disclosed a suspension of its export licences for China. You hold $340 of NVDA. Source: Reuters, 2h ago. ${CLOSER}`;
  const grove = `Nvidia disclosed a suspension of its export licences for China. You hold $18 of NVDA, all of it inside Titan Grove. Selling that part means exiting the Grove. ${CLOSER}`;
  ok("EOA example under 300 chars", eoa.length <= 300, String(eoa.length));
  ok("grove example under 300 chars", grove.length <= 300, String(grove.length));
  ok("no em dash in shipped copy", !/[–—]/.test(eoa + grove));
  ok("closer is verbatim", eoa.endsWith(CLOSER) && grove.endsWith(CLOSER));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
