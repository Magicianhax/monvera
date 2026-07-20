import "server-only";

// Vera's project knowledge — the compiled pack that rides in her system prompt
// so she can answer "what is Monvera / what does it cost / is it safe" without
// making anything up. Sources: the shared FAQ (already written in Vera's
// voice), the public roadmap, hard product facts, and a live-fetched index of
// docs.monvera.best (llms.txt, cached in-isolate) so the docs stay current
// without a web redeploy.
import { FAQ } from "@/lib/faq";
import { ROADMAP } from "@/lib/roadmap";

// Hard facts that must never drift (chain, custody, venue, token).
const CORE_FACTS = [
  "Monvera is an AI broker for real tokenized stocks and ETFs on Robinhood Chain (chain id 4663). Vera is the agent; Monvera is the product.",
  "Users hold real tokenized stocks (Apple, Nvidia, the S&P 500 and ~95 listed assets) in a self-custody smart account. Cash is USDG, a fully-backed digital dollar.",
  "Everything is gasless for the user (Monvera sponsors network fees) and non-custodial (only the user holds their keys; they can export the private key any time in Settings).",
  "Trades are routed for best execution across several venues on Robinhood Chain — every order is quoted at each live venue in parallel and filled wherever the user gets the most shares; if a venue fails to settle, the order automatically falls back to the next best. Monvera's revenue comes from a small routing fee built into the quoted price; there is no separate platform fee, no commission, and no subscription. Never name a specific venue as 'the' venue — which one wins varies per order.",
  "Every plan Vera builds is committed on-chain (VeraRecord / ERC-8004 identity) before money moves, so her track record is public and recorded on-chain. Say 'recorded on-chain', never 'cryptographically proven'.",
  "$MONVERA is OUR project token — the community's stake in Vera herself (launched on Virtuals, contract 0x7541872e32Bb529d7FF11D6C59832269ce33a6FF on Robinhood Chain, NOT Base). Be proud of it: holding 100,000 unlocks Scan to Buy, holders get new Vera abilities first, and holders get a voice in what she learns next. It trades gasless right in the app next to the stocks.",
  "$MONVERA tone: upbeat and proud — it's the home team's token. Quote its live price factually when asked, WITHOUT editorializing (no 'small/volatile/be careful' framing, no dwelling on red days). Never call it an investment product, never predict its price; if someone directly asks about its risk, answer briefly and honestly, then move on.",
  "Scan to Buy: photograph any product and Vera finds the listed companies behind it and builds a plan.",
  "Autopilot: recurring investing within hard, revocable limits the user authorizes once (amount, cadence, risk ceiling). The user can start, update, or stop it in the Autopilot panel.",
  "Minimum investment is about $1 for plans; single legs need at least $11 (venue minimum). Available worldwide — users are responsible for their own local rules.",
  "Docs live at docs.monvera.best. X: @monvera_best. Support: support@monvera.best.",
  "Backtests use 12 months of real history and are shown next to the S&P 500. History is never a promise of future returns; stocks can go down as well as up.",
  "A holding marked 'settling' is a fill that arrived wrapped from the venue and unwraps automatically, usually within 1-15 minutes. It is already bought, fully the user's, and counted in their balance. It just can't be sold until it lands. Nothing is stuck and nothing needs doing.",
  "Groves are curated stock baskets — strategies, never funds or ETFs — bought at published weights straight into the user's own wallet, non-custodial like everything else.",
  "Grove fees, exactly: $0 entry, $0 management, $0 rebalancing — the only fee is 10% of profit when you exit, measured against the user's own cost basis. No profit, no fee.",
  "Grove minimum: $20 for every Grove. Small amounts buy the largest holdings first (each placed order must clear the ~$11 venue floor); the whole basket is included as the amount grows.",
  "The four Groves: Tayyib Grove ($TAYYIB, AAOIFI shariah-screened — screened, not certified), Titan Grove ($TITAN, the mega-cap seven plus a Nasdaq-100 anchor), Silicon Grove ($SILIC, the AI chip supply chain), Rails Grove ($RAILS, crypto-infrastructure equities).",
  "Every Grove's full composition, exclusions with reasons, methodology, and 1-year backtest live at monvera.best/groves (detail pages: monvera.best/groves/tayyib, /titan, /silic, /rails).",
];

// ── live docs index (llms.txt) — best-effort, cached in the isolate ──
let docsCache: { text: string; at: number } | null = null;
const DOCS_TTL_MS = 6 * 60 * 60 * 1000;

async function docsIndex(): Promise<string | null> {
  if (docsCache && Date.now() - docsCache.at < DOCS_TTL_MS) return docsCache.text;
  try {
    const res = await fetch("https://docs.monvera.best/llms.txt", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return docsCache?.text ?? null;
    const raw = await res.text();
    // Keep it prompt-sized. Cut on a line boundary so a clipped index can never
    // end mid-URL and hand her a half-written path to cite. (The docs build
    // fails above 14KB, so this is a belt-and-braces guard.)
    const text = raw.length > 16_000 ? raw.slice(0, raw.lastIndexOf("\n", 16_000)) : raw;
    docsCache = { text, at: Date.now() };
    return text;
  } catch {
    return docsCache?.text ?? null;
  }
}

function roadmapBlock(): string {
  return ROADMAP.map(
    (p) => `${p.title} — ${p.lede}\n${p.items.map((i) => `  • ${i.name}: ${i.note}`).join("\n")}`,
  ).join("\n");
}

/** The full knowledge pack for Vera's system prompt (~8-14KB). */
export async function veraKnowledgeBlock(): Promise<string> {
  const docs = await docsIndex();
  return [
    "PRODUCT FACTS (ground truth — never contradict these):",
    ...CORE_FACTS.map((f) => "- " + f),
    "",
    "ROADMAP (public, from the app):",
    roadmapBlock(),
    "",
    "FAQ (answer in this same voice):",
    ...FAQ.map((f) => `Q: ${f.q}\nA: ${f.a}`),
    ...(docs
      ? [
          "",
          "DOCS INDEX (docs.monvera.best — point users at relevant pages).",
          "Treat this as a closed list: cite only URLs that appear below, never invent a path.",
          "If nothing fits, say so and point at docs.monvera.best.",
          docs,
        ]
      : []),
  ].join("\n");
}
