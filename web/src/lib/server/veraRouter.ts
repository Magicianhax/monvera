import "server-only";

// Vera's chat brain — a single-call JSON intent router on the existing
// inference stack (Virtuals → Venice → Anthropic). One generateObject call
// classifies the turn AND answers directly when the answer is in-context
// (portfolio, market, project questions). Only build_plan / review_portfolio
// trigger a second AI pass — the same battle-tested functions the app already
// runs. The salvage path (rawTextFrom + extractJson + zod.parse) is copied
// from allocate.ts because the Virtuals proxy strips response_format.
import { z } from "zod";
import { generateObject } from "ai";
import { resolveAllocationModel, activeModelId } from "@/lib/server/aiModel";
import { buildAllocation, extractJson, rawTextFrom } from "@/lib/server/allocate";
import { backtestBasket } from "@/lib/server/quant";
import { reviewPortfolio } from "@/lib/server/portfolioReview";
import { getDaySummary } from "@/lib/server/marketData";
import { veraKnowledgeBlock } from "@/lib/server/veraKnowledge";
import { isTradable, filterTradable, liquidSuggestions, indicativeQuote } from "@/lib/server/tradability";
import { createAlert, listAlerts, deleteAlert, listNotifications, unreadCount, markAllRead } from "@/lib/server/notifyStore";
import { getVeraRecordServer, getUserActivityServer, getReputationServer } from "@/lib/server/executorLogs";
import { getAutopilot, upsertAutopilot, listRuns } from "@/lib/server/autopilotStore";
import { listWatchlist, addWatch, removeWatch } from "@/lib/server/watchlistStore";
import { getPublicThemes, getThemeDef, THEME_DEFS } from "@/lib/server/themes";
import { getPublicStrategies } from "@/lib/server/strategies";
import { getBuybackData } from "@/lib/server/buybackStore";
import { getHistory, type MarketRange } from "@/lib/server/marketData";
import { universeStatsRows } from "@/lib/server/quant";
import { priceAllWithFallback } from "@/lib/server/pricing";
import { getMonveraSpot } from "@/lib/server/monveraPrice";
import { createPublicClient, http } from "viem";
import { chain } from "@/lib/chain";
import { MULTICALL3 } from "@/lib/tokens";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { ALL_ASSETS } from "@/lib/tokens";
import { displayFor } from "@/lib/displayAssets";
import { GROVES, grovePreviewMinUsd, type GroveDef } from "@/lib/groves";
import { getGroves } from "@/lib/server/groveService";

const BUYABLE = ALL_ASSETS.filter((a) => !displayFor(a.symbol).coming);

// ── the turn schema: what the model must return ──
const TurnSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("reply"),
    message: z.string().min(1).max(2200).describe("Vera's answer, plain words, honest."),
    suggestions: z.array(z.string().min(1).max(48)).max(4).optional()
      .describe("When the reply asks the user something, 2-4 short tappable answers they could give (e.g. '$25 weekly, balanced'). Omit otherwise."),
  }),
  z.object({
    intent: z.literal("build_plan"),
    goal: z.string().min(1).max(300).describe("The investing goal, restated plainly."),
    amountUsd: z.number().positive().max(1_000_000).optional().describe("Dollars to invest — ONLY if the user stated an amount in this message or the recent conversation. NEVER assume their whole balance."),
    risk: z.enum(["conservative", "balanced", "aggressive"]).optional(),
    message: z.string().max(400).optional().describe("One line to say while building."),
  }),
  z.object({
    intent: z.literal("review_portfolio"),
    message: z.string().max(300).optional(),
  }),
  z.object({
    intent: z.literal("open"),
    target: z.enum(["portfolio", "market", "wallet", "token", "autopilot", "vera", "scan", "activity", "alerts", "insights", "holding", "send", "receive", "settings"]),
    symbol: z.string().min(1).max(12).optional().describe('Required when target is "holding": which stock\'s page to open.'),
    message: z.string().max(500).optional().describe("One or two lines telling the user what you opened and why."),
  }),
  z.object({
    intent: z.literal("sell"),
    symbol: z.string().min(1).max(12).optional().describe("The ticker to sell. Omit when selling everything."),
    amountUsd: z.number().positive().max(1_000_000).optional().describe("Dollars to sell — ONLY if the user stated an amount or fraction (compute dollars from their position for 'half' etc.)."),
    all: z.boolean().optional().describe("True for 'sell everything' / 'cash out' (no symbol) or 'sell all my X' (with symbol)."),
    message: z.string().max(300).optional(),
  }),
  z.object({
    intent: z.literal("quote"),
    symbol: z.string().min(1).max(12),
    side: z.enum(["buy", "sell"]).describe("buy unless they clearly mean selling."),
    amountUsd: z.number().positive().max(1_000_000),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("preference"),
    setting: z.enum(["theme", "palette"]),
    value: z.string().min(1).max(24).describe('theme: "light"|"dark". palette: emerald|sapphire|violet|amber|rose|slate.'),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("list_alerts"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("cancel_alert"),
    symbol: z.string().min(1).max(12).optional().describe("Which alert to cancel; omit when cancelling all."),
    all: z.boolean().optional().describe("True to cancel every active alert."),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("inbox"),
    markRead: z.boolean().optional().describe("True when the user says to clear/dismiss/mark read."),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("autopilot_status"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("autopilot_stop"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("price_history"),
    symbol: z.string().min(1).max(12),
    range: z.enum(["1W", "1M", "1Y"]).optional().describe("Defaults to 1M."),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("compare"),
    symbols: z.array(z.string().min(1).max(12)).min(2).max(3),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("my_activity"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("themes"),
    slug: z.string().max(24).optional().describe("A specific theme (ai, semiconductors, quantum, space, crypto, cloud, energy, fintech) when they asked about one."),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("strategies"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("watchlist"),
    action: z.enum(["list", "add", "remove"]),
    symbol: z.string().min(1).max(12).optional(),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("buyback"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("liquidity"),
    symbol: z.string().min(1).max(12),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("screener"),
    metric: z.enum(["gainers", "losers", "steady", "volatile"]).optional(),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("autopilot_config"),
    amountUsd: z.number().min(11).max(100_000).describe("Dollars per run (venue minimum $11)."),
    cadence: z.enum(["daily", "weekly", "biweekly", "monthly"]),
    risk: z.enum(["careful", "balanced", "bolder"]),
    message: z.string().max(400).optional().describe("One line: you've filled the Autopilot form with their numbers, they hit Start to authorize."),
  }),
  z.object({
    intent: z.literal("rebalance"),
    tilt: z.string().max(160).optional().describe("Optional direction from the user, e.g. 'less tech-heavy', 'safer'."),
    message: z.string().max(300).optional(),
  }),
  z.object({
    intent: z.literal("set_alert"),
    symbol: z.string().min(1).max(12),
    direction: z.enum(["above", "below"]),
    threshold: z.number().positive().max(10_000_000).describe("The trigger price in dollars."),
    message: z.string().max(300).optional(),
  }),
  z.object({
    intent: z.literal("track_record"),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("order"),
    symbol: z.string().min(1).max(12).describe("The ticker, e.g. AAPL, or MONVERA for the project token."),
    side: z.enum(["buy", "sell"]),
    amountUsd: z.number().positive().max(1_000_000).optional().describe("Dollars, ONLY if the user stated an amount."),
    message: z.string().max(400).optional().describe("One line confirming you opened the ticket."),
  }),
  z.object({
    intent: z.literal("grove_list"),
    message: z.string().max(300).optional(),
  }),
  z.object({
    intent: z.literal("grove_info"),
    groveId: z.string().min(1).max(24).describe('Which Grove: "tayyib", "titan", "silic", or "rails".'),
    message: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("grove_buy"),
    groveId: z.string().min(1).max(24),
    amountUsd: z.number().positive().max(1_000_000).optional().describe("Dollars — ONLY if the user stated an amount."),
    message: z.string().max(300).optional(),
  }),
  z.object({
    intent: z.literal("grove_auto"),
    groveId: z.string().min(1).max(24),
    action: z.enum(["enable", "disable"]),
    message: z.string().max(200).optional(),
  }),
]);
export type VeraTurn = z.infer<typeof TurnSchema>;

export interface VeraContext {
  text: string;
  /** Privy userId of the verified caller — lets the router read/write their D1 rows. */
  userId?: string;
  /** The user's wallet address — required for on-chain reads (their own activity). */
  address?: string;
  cashUsd?: number;
  investedUsd?: number;
  holdings?: { symbol: string; qty: number; valueUsd?: number; dayChangePct?: number; settlingUsd?: number }[];
  recent?: string[];
}

export type VeraResult =
  | { intent: "reply"; message: string; suggestions?: string[] }
  | { intent: "plan"; message: string; payload: Record<string, unknown> }
  | { intent: "open"; target: string; symbol?: string; message: string }
  | { intent: "review"; message: string; payload: Record<string, unknown> }
  | { intent: "sell_plan"; message: string; legs: { symbol: string; amountUsd: number; all: boolean }[]; totalUsd: number }
  | { intent: "preference"; setting: "theme" | "palette"; value: string; message: string }
  | { intent: "order"; symbol: string; side: "buy" | "sell"; amountUsd?: number; message: string }
  | { intent: "token_order"; side: "buy" | "sell"; amountUsd: number; message: string }
  | { intent: "autopilot"; amountUsd: number; cadence: "daily" | "weekly" | "biweekly" | "monthly"; risk: "careful" | "balanced" | "bolder"; message: string }
  | { intent: "grove_list"; message: string; groves: { id: string; name: string; ticker: string; thesis: string; minBuyUsd: number; returnPct: number | null; spyPct: number | null }[] };

const SYMBOLS = new Set(BUYABLE.map((a: { symbol: string }) => a.symbol));

/** Compact market pulse for the prompt: today's biggest moves, cached upstream. */
async function marketPulse(): Promise<string> {
  try {
    const day = await getDaySummary();
    const rows = Object.entries(day)
      .map(([sym, d]) => ({ sym, pct: d.dayChangePct }))
      .filter((r) => typeof r.pct === "number" && isFinite(r.pct as number));
    rows.sort((a, b) => (b.pct as number) - (a.pct as number));
    const up = rows.slice(0, 5).map((r) => `${r.sym} +${(r.pct as number).toFixed(1)}%`).join(", ");
    const down = rows.slice(-5).reverse().map((r) => `${r.sym} ${(r.pct as number).toFixed(1)}%`).join(", ");
    return `Today's moves — leaders: ${up}. Laggards: ${down}.`;
  } catch {
    return "Live day moves are unavailable right now — say so if asked about today's market.";
  }
}

// Same batched client the /api/prices route uses — one multicall per sweep.
const priceClient = createPublicClient({
  chain: {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls,
    contracts: { multicall3: { address: MULTICALL3 } },
  },
  batch: { multicall: { wait: 16 } },
  transport: http(SERVER_RPC_URL),
});

/** Live spot prices for the whole universe + $MONVERA — so Vera can quote real numbers. */
async function pricesBlock(): Promise<string> {
  try {
    const [all, mon] = await Promise.all([
      priceAllWithFallback(priceClient),
      getMonveraSpot().catch(() => null),
    ]);
    const rows = Object.values(all)
      .filter((a) => typeof a.priceUsd === "number")
      .map((a) => `${a.symbol} $${(a.priceUsd as number) < 1 ? (a.priceUsd as number).toFixed(4) : (a.priceUsd as number).toFixed(2)}`);
    if (mon) rows.push(`MONVERA $${mon.priceUsd.toFixed(6)} (${mon.change24h >= 0 ? "+" : ""}${mon.change24h.toFixed(1)}% 24h)`);
    return rows.length ? "LIVE PRICES (USD, right now): " + rows.join(" · ") : "Live prices are unavailable right now — say so if asked for a price.";
  } catch {
    return "Live prices are unavailable right now — say so if asked for a price.";
  }
}

/** What the user has running right now — so any turn can reference it without
 *  a round trip ("you have 2 alerts and autopilot is on"). Best-effort. */
async function accountBlock(ctx: VeraContext): Promise<string> {
  if (!ctx.userId) return "";
  const [alerts, auto, unread] = await Promise.all([
    listAlerts(ctx.userId).catch(() => []),
    getAutopilot(ctx.userId).catch(() => null),
    unreadCount(ctx.userId).catch(() => 0),
  ]);
  const live = alerts.filter((a) => a.active);
  const lines: string[] = [];
  lines.push(
    live.length
      ? `ACTIVE PRICE ALERTS (${live.length}): ` + live.map((a) => `${a.symbol} ${a.direction} $${a.threshold}`).join(" · ")
      : "ACTIVE PRICE ALERTS: none.",
  );
  lines.push(
    auto
      ? `AUTOPILOT: ${auto.active ? "ON" : "paused"} — $${auto.amountUsd} ${auto.cadence}, ${auto.runs} runs so far${auto.active ? `, next run ${new Date(auto.nextRunAt * 1000).toUTCString().slice(0, 16)}` : ""}.`
      : "AUTOPILOT: not set up.",
  );
  if (unread > 0) lines.push(`UNREAD NOTIFICATIONS: ${unread}.`);
  return lines.join("\n");
}

function contextBlock(ctx: VeraContext): string {
  const lines: string[] = [];
  if (ctx.holdings?.length) {
    lines.push(
      "USER'S PORTFOLIO (live, real): " +
        ctx.holdings
          .map((h) => `${h.symbol} ${h.valueUsd !== undefined ? "$" + h.valueUsd.toFixed(2) : h.qty}${typeof h.dayChangePct === "number" ? ` (${h.dayChangePct >= 0 ? "+" : ""}${h.dayChangePct.toFixed(2)}% today)` : ""}${h.settlingUsd ? ` · $${h.settlingUsd.toFixed(2)} settling` : ""}`)
          .join(" · "),
    );
  } else {
    lines.push("USER'S PORTFOLIO: no stock holdings yet.");
  }
  if (ctx.cashUsd !== undefined) lines.push(`Cash: $${ctx.cashUsd.toFixed(2)} USDG.`);
  if (ctx.investedUsd !== undefined) lines.push(`Invested: $${ctx.investedUsd.toFixed(2)}.`);
  if (ctx.recent?.length) lines.push("RECENT CONVERSATION:\n" + ctx.recent.slice(-14).join("\n"));
  return lines.join("\n");
}

async function systemPrompt(ctx: VeraContext): Promise<string> {
  const [knowledge, pulse, prices, account] = await Promise.all([
    veraKnowledgeBlock(),
    marketPulse(),
    pricesBlock(),
    accountBlock(ctx).catch(() => ""),
  ]);
  return [
    "You are Vera, Monvera's AI broker. Warm, plain-spoken, honest; never hype, never invent numbers. You only know the numbers given below — if you don't have a figure, say so.",
    "",
    knowledge,
    "",
    "TRADABLE UNIVERSE (the only stock symbols that exist here): " + [...SYMBOLS].join(", ") + ". MONVERA is the project token (its own ticket, not a stock).",
    pulse,
    prices,
    "",
    contextBlock(ctx),
    account,
    "",
    "DECIDE THE TURN'S INTENT and respond with ONLY a raw JSON object (no markdown, no fences, no prose around it):",
    '- Wants a diversified investment / has a goal ("grow my money", "invest $50 in AI") → {"intent":"build_plan","goal":...,"risk":...}. Include "amountUsd" ONLY when the user stated an amount (this message or the recent conversation) — if they did not, OMIT it and I will ask them how much.',
    '- Wants to REBALANCE / fix their mix with new money ("rebalance me", "make my portfolio less tech heavy") → {"intent":"rebalance","tilt":...}. Needs cash; if they have none, "reply" honestly that rebalancing here works by topping up underweights with cash.',
    '- Asks how their portfolio looks / wants a health check → {"intent":"review_portfolio"} (a deeper engine runs it). If they have no holdings, "reply" honestly instead.',
    '- Asks a QUESTION about their money, the market, a stock, Monvera, $MONVERA, fees, safety, custody, the roadmap, docs → {"intent":"reply","message":...} answered from the context above. Cite real numbers only.',
    '- Wants a PRICE ALERT ("tell me when NVDA drops below 150", "alert me if AAPL hits 250") → {"intent":"set_alert","symbol":...,"direction":"above"|"below","threshold":...}. Use "below" for drops/dips, "above" for hits/rises.',
    '- Asks about YOUR track record / receipts / proof → {"intent":"track_record"} (real on-chain numbers get attached).',
    '- Wants to buy ONE specific stock or trade the $MONVERA token → {"intent":"order","symbol":...,"side":...,"amountUsd": only if they said a number}. symbol must be from the universe or MONVERA.',
    '- Wants to SELL a stock ("sell half my NVDA", "sell $50 of Apple") → {"intent":"sell","symbol":...,"amountUsd": dollars if stated — for "half"/"a third", compute dollars from their position value in the context above; "all my X" → {"symbol":...,"all":true}}. Wants to SELL EVERYTHING / cash out → {"intent":"sell","all":true}. You place sells yourself in chat — the user confirms, every leg gets a receipt.',
    '- Asks for HELP DECIDING how much of a stock to buy/sell → {"intent":"reply"} with a short honest take grounded in the data above, plus "suggestions" of concrete next messages like "Buy $15 of AAPL" / "Buy $50 of AAPL" (use their cash to pick sensible sizes, legs need $11+).',
    '- Wants recurring investing / autopilot: if you ALREADY know their amount (≥$11), cadence, and risk (from this message or the recent conversation) → {"intent":"autopilot_config","amountUsd":...,"cadence":...,"risk":...}. If details are missing, ask via "reply" WITH suggestions. Just wants the panel → {"intent":"open","target":"autopilot",...}. Wants to scan a product → target "scan". Wants to see activity/alerts/track record/wallet/market → the matching target.',
    '- Asks WHAT ALERTS they have → {"intent":"list_alerts"}. Wants one CANCELLED ("cancel the Tesla alert", "remove all my alerts") → {"intent":"cancel_alert","symbol":...} or {"all":true}.',
    '- Asks what they MISSED / notifications / "anything happen?" → {"intent":"inbox"}; add "markRead":true when they say clear/dismiss/mark read.',
    '- Asks whether AUTOPILOT is on, when it next runs, or what it bought → {"intent":"autopilot_status"}. Asks to STOP/PAUSE it → {"intent":"autopilot_stop"}.',
    '- Asks how a stock has PERFORMED over time ("how has NVDA done this month", "AAPL over the past year") → {"intent":"price_history","symbol":...,"range":"1W"|"1M"|"1Y"}.',
    '- Asks to COMPARE two or three stocks ("AAPL vs NVDA") → {"intent":"compare","symbols":[...]}.',
    '- Asks about THEIR OWN history — what they have bought, their past invests, their transfers → {"intent":"my_activity"}.',
    '- Asks about a THEME or sector basket ("what\'s in your AI theme", "show me themes") → {"intent":"themes","slug": optional}. Asks about your named STRATEGIES / model portfolios ("what\'s your steadiest strategy") → {"intent":"strategies"}.',
    '- Asks about GROVES — my curated strategy baskets ($TAYYIB shariah-screened, $TITAN mag-7, $SILIC chips, $RAILS crypto equities): "what groves/baskets do you have" → {"intent":"grove_list"}. Asks what\'s IN one or about one → {"intent":"grove_info","groveId":"tayyib"|"titan"|"silic"|"rails"}. Wants to BUY one → {"intent":"grove_buy","groveId":...,"amountUsd": only if they said a number}. Wants auto-manage on/off for one → {"intent":"grove_auto","groveId":...,"action":"enable"|"disable"}.',
    '- Asks about their WATCHLIST, or to watch/unwatch a stock → {"intent":"watchlist","action":"list"|"add"|"remove","symbol":...}.',
    '- Asks about the $MONVERA BUYBACK, treasury, or revenue → {"intent":"buyback"}.',
    '- Asks whether a stock is BUYABLE / has liquidity right now → {"intent":"liquidity","symbol":...}.',
    '- Asks for RANKINGS of the universe ("biggest gainers", "steadiest names", "most volatile") → {"intent":"screener","metric":"gainers"|"losers"|"steady"|"volatile"}.',
    '- Wants to see ONE stock\'s page → {"intent":"open","target":"holding","symbol":"AAPL"}.',
    '- Wants to ADD CASH / deposit / their address -> {"intent":"open","target":"receive"}. Wants to SEND money out -> {"intent":"open","target":"send"} (they fill and confirm the transfer themselves). Wants settings/appearance/key export -> {"intent":"open","target":"settings"} - NEVER read out, export, or handle their private key yourself; the export flow is click-only by design.',
    '- Asks what an amount WOULD GET them ("what would $50 of Apple get me?") → {"intent":"quote","symbol":...,"side":...,"amountUsd":...}.',
    '- Asks to change THEME (dark/light) or the app COLOR → {"intent":"preference","setting":"theme"|"palette","value":...}. You cannot change anything else in settings — for key export or sign-out, open settings instead and NEVER handle the key.',
    '- Anything else (greetings, thanks, chit-chat, unclear) → {"intent":"reply"} in Vera\'s voice, briefly.',
    'When your reply asks the user a question, ALSO include "suggestions": 2-4 short tappable example answers (each under ~40 chars) they can pick and edit.',
    "Never claim an action happened that didn't. Opening a ticket or panel is a handoff — the user confirms everything themselves.",
  ].join("\n");
}

/** Near-miss repair: the model often returns a VALID intent with one field a
 *  synonym off the enum ("risk":"moderate"). Coerce the common drifts so the
 *  turn survives instead of collapsing to a raw-JSON reply. */
function repairTurn(o: Record<string, unknown>): Record<string, unknown> {
  const r = { ...o };
  if (typeof r.risk === "string") {
    const v = r.risk.toLowerCase();
    if (["moderate", "medium", "mid", "normal", "balance"].includes(v)) r.risk = "balanced";
    else if (["safe", "low", "cautious", "steady", "careful"].includes(v)) r.risk = "conservative";
    else if (["bold", "high", "risky", "growth", "bolder"].includes(v)) r.risk = "aggressive";
  }
  if (typeof r.amountUsd === "string") {
    const n = parseFloat((r.amountUsd as string).replace(/[$,]/g, ""));
    if (isFinite(n)) r.amountUsd = n; else delete r.amountUsd;
  }
  if (typeof r.threshold === "string") {
    const n = parseFloat((r.threshold as string).replace(/[$,]/g, ""));
    if (isFinite(n)) r.threshold = n;
  }
  if (typeof r.side === "string") r.side = (r.side as string).toLowerCase();
  if (typeof r.direction === "string") {
    const v = (r.direction as string).toLowerCase();
    r.direction = ["below", "under", "down", "drops"].includes(v) ? "below" : "above";
  }
  if (typeof r.cadence === "string") {
    const v = (r.cadence as string).toLowerCase();
    if (v.startsWith("bi")) r.cadence = "biweekly";
    else if (v.startsWith("dai")) r.cadence = "daily";
    else if (v.startsWith("week")) r.cadence = "weekly";
    else if (v.startsWith("month")) r.cadence = "monthly";
  }
  return r;
}

/** Best-effort recovery of a turn from raw model text (fenced/partial JSON or prose). */
function salvageTurn(raw: string): VeraTurn {
  let parsed: unknown = null;
  try {
    parsed = extractJson(raw);
  } catch {
    /* no JSON at all — fall through to prose */
  }
  if (parsed && typeof parsed === "object") {
    try {
      return TurnSchema.parse(parsed);
    } catch {
      // One enum synonym off? Repair the common drifts and try once more.
      try {
        return TurnSchema.parse(repairTurn(parsed as Record<string, unknown>));
      } catch {
        /* still off — fall through */
      }
      const o = parsed as { message?: unknown; goal?: unknown };
      if (typeof o.message === "string" && o.message.trim()) {
        return { intent: "reply", message: o.message.trim().slice(0, 2200) };
      }
      // A build_plan with a goal survives even with everything else broken.
      if (typeof o.goal === "string" && o.goal.trim()) {
        return { intent: "build_plan", goal: o.goal.trim().slice(0, 300) };
      }
    }
  }
  // Plain prose: deliver the model's words. But NEVER raw JSON — a brace dump
  // in the chat is worse than asking the user to repeat themselves.
  const prose = raw.replace(/```[a-z]*\n?|```/g, "").trim();
  const looksLikeJson = prose.startsWith("{") || prose.startsWith("[");
  return {
    intent: "reply",
    message: looksLikeJson || !prose
      ? "I lost my train of thought there. Mind saying that again?"
      : prose.slice(0, 2200),
  };
}

/** One turn of Vera's brain. Throws only on total inference failure. */
export async function routeVera(ctx: VeraContext): Promise<VeraResult> {
  let turn: VeraTurn;
  try {
    const { object } = await generateObject({
      model: resolveAllocationModel(),
      schema: TurnSchema,
      system: await systemPrompt(ctx),
      prompt: ctx.text,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(28_000),
    });
    turn = object;
  } catch (err) {
    // The Virtuals proxy strips response_format, so the model may answer with
    // wrapped JSON, partial JSON, or plain prose. Salvage in order: parse the
    // JSON; else deliver the model's own words as a reply. A turn should only
    // fail when there is genuinely nothing to show.
    const raw = rawTextFrom(err);
    if (!raw) throw err;
    turn = salvageTurn(raw);
  }

  switch (turn.intent) {
    case "build_plan": {
      // Never assume how much of their money to deploy — a goal without an
      // amount gets a question with tappable sizes from their real cash.
      if (turn.amountUsd === undefined) {
        const cash = Math.floor(ctx.cashUsd ?? 0);
        if (cash < 1) {
          return { intent: "open", target: "receive", message: "You'll need some cash in the account first. I opened your deposit address: add some USDG, then tell me the goal again." };
        }
        const sizes = [25, 50, 100].filter((v) => v <= cash);
        const opts = sizes.map((v) => `Invest $${v}`);
        opts.push(`Invest all $${cash}`);
        return {
          intent: "reply",
          message: `How much should I put to work? You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash. Any amount from $1 works.`,
          suggestions: [...new Set(opts)].slice(0, 4),
        };
      }
      const allocation = await buildAllocation(turn.goal, turn.amountUsd, turn.risk);
      const backtest = await backtestBasket(allocation.allocations).catch(() => null);
      return {
        intent: "plan",
        message: turn.message ?? "",
        payload: { ...allocation, backtest, amountUsd: turn.amountUsd, model: activeModelId() },
      };
    }
    case "review_portfolio": {
      const holdings = (ctx.holdings ?? [])
        .filter((h) => (h.valueUsd ?? 0) > 0)
        .map((h) => ({ symbol: h.symbol, weightPct: Math.max(0.01, h.valueUsd ?? 0) }));
      if (holdings.length === 0) {
        return { intent: "reply", message: "You don't hold any stocks yet, so there's nothing to review — tell me a goal and I'll build your first plan." };
      }
      const review = await reviewPortfolio(holdings);
      // The engine computes concentration, theme clusters and a real backtest —
      // ship the WHOLE object so the thread renders a card, not a paragraph.
      return { intent: "review", message: review.narrative.verdict, payload: review as unknown as Record<string, unknown> };
    }
    case "order": {
      const symbol = turn.symbol.toUpperCase();
      if (symbol !== "MONVERA" && !SYMBOLS.has(symbol)) {
        return { intent: "reply", message: `I don't have ${symbol} in the tradable universe — try the Market panel to see everything available.` };
      }
      // Buying IN CHAT happens WITH Vera: a stock buy becomes a one-leg plan
      // the user confirms right here (her rails, signed + recorded on-chain).
      // $MONVERA rides its own swap route, and sells stay manual by design —
      // those two hand off to the dedicated ticket.
      if (turn.side === "buy" && symbol !== "MONVERA") {
        // Liquidity first: never build an order no venue can fill. Suggest
        // live alternatives instead of letting the leg die at invest time.
        if (!(await isTradable(symbol).catch(() => true))) {
          const alts = await liquidSuggestions(symbol).catch(() => []);
          return {
            intent: "reply",
            message: `${symbol} is listed but no trading venue can fill it right now — that happens when maker inventory runs dry. Want one of these instead, or try ${symbol} again later?`,
            suggestions: alts.map((a) => `Buy $25 of ${a}`),
          };
        }
        const cash = Math.floor(ctx.cashUsd ?? 0);
        const amount = turn.amountUsd !== undefined ? Math.floor(turn.amountUsd) : undefined;
        if (amount === undefined) {
          // Ask the amount, with sensible tappable sizes from their real cash.
          const sizes = [15, 25, 50, 100].filter((v) => v <= cash);
          const opts = (sizes.length ? sizes : [11]).slice(-3).map((v) => `Buy $${v} of ${symbol}`);
          if (cash >= MIN_LEG_USD) opts.push(`Buy $${cash} of ${symbol} (all my cash)`);
          return {
            intent: "reply",
            message: `How much ${symbol}? You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash. A single order needs at least $${MIN_LEG_USD}.`,
            suggestions: [...new Set(opts)].slice(0, 4),
          };
        }
        if (amount < MIN_LEG_USD) {
          return { intent: "reply", message: `A single order needs at least $${MIN_LEG_USD}, the venue minimum. Round up to $${MIN_LEG_USD}?`, suggestions: [`Buy $${MIN_LEG_USD} of ${symbol}`] };
        }
        if (amount > cash) {
          return {
            intent: "reply",
            message: `You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash, so $${amount} won't clear. Size it down?`,
            suggestions: cash >= MIN_LEG_USD ? [`Buy $${cash} of ${symbol}`] : undefined,
          };
        }
        const allocations = [{ symbol, weightPct: 100, reason: "Your direct pick — a single-stock order, concentrated by design." }];
        const backtest = await backtestBasket(allocations).catch(() => null);
        return {
          intent: "plan",
          // Always our own line — the model may have phrased a ticket handoff.
          message: `Your ${symbol} order is ready: $${amount}, all in one name. Tap invest and I'll place it, signed and recorded on-chain.`,
          payload: {
            summary: `Buy ${symbol} — your direct order`,
            rationale: `You asked for ${symbol} specifically, so this is a single-position order, not a diversified plan. It carries single-stock risk on purpose.`,
            riskScore: 7500,
            allocations,
            backtest,
            amountUsd: amount,
            model: activeModelId(),
          },
        };
      }
      // $MONVERA with a stated amount: confirm and execute right in chat (its
      // own swap route, client-signed on confirm). Without an amount, ask.
      if (symbol === "MONVERA") {
        const amount = turn.amountUsd !== undefined ? Math.floor(turn.amountUsd) : undefined;
        const cash = Math.floor(ctx.cashUsd ?? 0);
        const heldMonUsd = (ctx.holdings ?? []).find((h) => h.symbol === "MONVERA")?.valueUsd ?? 0;
        if (amount === undefined) {
          const base = turn.side === "buy" ? cash : Math.floor(heldMonUsd);
          const sizes = [10, 25, 50].filter((v) => v <= base);
          if (base > 0) sizes.push(base);
          return {
            intent: "reply",
            message: turn.side === "buy"
              ? `How much $MONVERA? You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash.`
              : `How much $MONVERA should I sell? You hold about $${heldMonUsd.toFixed(2)} worth.`,
            suggestions: [...new Set(sizes)].slice(0, 4).map((v) => `${turn.side === "buy" ? "Buy" : "Sell"} $${v} of MONVERA`),
          };
        }
        if (turn.side === "buy" && amount > cash) {
          return { intent: "reply", message: `You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash, so $${amount} won't clear. Size it down?`, suggestions: cash > 0 ? [`Buy $${cash} of MONVERA`] : undefined };
        }
        if (turn.side === "sell" && heldMonUsd <= 0) {
          return { intent: "reply", message: "You don't hold any $MONVERA yet. Buy some first." };
        }
        return { intent: "token_order", side: turn.side, amountUsd: amount, message: `${turn.side === "buy" ? "Buying" : "Selling"} $${amount} of $MONVERA over its own route, gas on us. Confirm below and I'll place it.` };
      }
      // Stock sells are chat-native now, same as buys — route into the sell flow.
      return sellPlan(ctx, symbol, turn.amountUsd, undefined);
    }
    case "autopilot_config":
      return { intent: "autopilot", amountUsd: turn.amountUsd, cadence: turn.cadence, risk: turn.risk, message: turn.message ?? "I've filled the Autopilot form with your numbers — review and hit Start to authorize it." };
    case "rebalance":
      return rebalancePlan(ctx, turn.tilt);
    case "set_alert": {
      const symbol = turn.symbol.toUpperCase();
      if (!SYMBOLS.has(symbol)) {
        return { intent: "reply", message: `I don't track ${symbol} — it's not in the tradable universe here.` };
      }
      if (!ctx.userId) {
        return { intent: "reply", message: "I couldn't attach that alert to your account just now — try again in a moment." };
      }
      // Same rules as POST /api/alerts: seconds since epoch, max 20 live alerts.
      const live = (await listAlerts(ctx.userId).catch(() => [])).filter((a) => a.active);
      if (live.length >= 20) {
        return { intent: "reply", message: "You're at the 20-alert limit. Cancel one first — say \"list my alerts\" and tell me which to drop." };
      }
      await createAlert(ctx.userId, { symbol, direction: turn.direction, threshold: turn.threshold, at: Math.floor(Date.now() / 1000) });
      const dirWord = turn.direction === "above" ? "reaches" : "falls to";
      return {
        intent: "reply",
        message: turn.message ?? `Done — I'll ping you when ${symbol} ${dirWord} $${turn.threshold}. You'll see it in Notifications, and you can manage alerts there any time.`,
      };
    }
    case "track_record": {
      const [rec, rep] = await Promise.all([
        getVeraRecordServer().catch(() => null),
        getReputationServer().catch(() => null),
      ]);
      if (!rec) return { intent: "reply", message: "I couldn't load the on-chain record just now — the Track record panel has the full history." };
      const recent = rec.recentRecommendations.slice(0, 3)
        .map((r) => `• plan ${r.planId.slice(0, 10)}… ${r.usdcSpent !== undefined ? `invested $${r.usdcSpent.toFixed(2)}` : "recommended"} (robinhoodchain.blockscout.com/tx/${r.txHash})`)
        .join("\n");
      return {
        intent: "reply",
        message: [
          `Everything I do is recorded on-chain before money moves. So far: ${rec.totalRecommendations} plans committed, ${rec.executedCount} executed, $${rec.totalExecutedUsd.toFixed(2)} placed.${rep !== null ? ` My ERC-8004 reputation score sits at ${rep.toString()}.` : ""}`,
          recent,
          "The Track record panel shows the full list with receipts.",
        ].filter(Boolean).join("\n"),
      };
    }
    case "sell": {
      return sellPlan(ctx, turn.symbol, turn.amountUsd, turn.all);
    }
    case "quote": {
      const sym = turn.symbol.toUpperCase();
      if (sym === "MONVERA") return { intent: "reply", message: "For $MONVERA, just tell me the amount and I'll show the live route right on the confirm card — say \"buy $25 of MONVERA\".", suggestions: ["Buy $25 of MONVERA"] };
      if (!SYMBOLS.has(sym)) return { intent: "reply", message: `${sym} isn't in the tradable universe here.` };
      const q = await indicativeQuote(sym, turn.side, turn.amountUsd).catch(() => null);
      if (!q) return { intent: "reply", message: `I can't price ${sym} right now — no venue is quoting it this minute. It usually comes back quickly.` };
      const name = displayFor(sym).name || sym;
      if (turn.side === "buy") {
        const shares = Number(q.outRaw) / 1e18;
        return {
          intent: "reply",
          message: `$${turn.amountUsd.toFixed(2)} of ${name} gets you about ${shares < 1 ? shares.toFixed(4) : shares.toFixed(2)} shares at today's quote. Gas is on us and the price includes the quoted spread. Single orders need at least $${MIN_LEG_USD}.`,
          suggestions: [`Buy $${Math.max(MIN_LEG_USD, Math.floor(turn.amountUsd))} of ${sym}`],
        };
      }
      const cash = Number(q.outRaw) / 1e6;
      return {
        intent: "reply",
        message: `Selling about $${turn.amountUsd.toFixed(2)} of ${name} brings back roughly $${cash.toFixed(2)} in cash at today's quote. Gas is on us, spread included.`,
        suggestions: [`Sell $${Math.floor(turn.amountUsd)} of ${sym}`],
      };
    }
    case "preference": {
      const v = turn.value.toLowerCase();
      const okTheme = turn.setting === "theme" && ["light", "dark"].includes(v);
      const okPal = turn.setting === "palette" && ["emerald", "sapphire", "violet", "amber", "rose", "slate"].includes(v);
      if (!okTheme && !okPal) {
        return { intent: "reply", message: turn.setting === "theme" ? "I can switch between light and dark." : "Palettes I have: emerald, sapphire, violet, amber, rose, slate." };
      }
      return { intent: "preference", setting: turn.setting, value: v, message: turn.message ?? (turn.setting === "theme" ? `Switched to ${v} mode.` : `Recolored everything ${v}. Ask any time to change it back.`) };
    }
    case "list_alerts": {
      if (!ctx.userId) return { intent: "reply", message: "I couldn't read your alerts just now — try again in a moment." };
      const alerts = (await listAlerts(ctx.userId).catch(() => [])).filter((a) => a.active);
      if (alerts.length === 0) {
        return {
          intent: "reply",
          message: "You have no price alerts running. Tell me a level and I'll watch it, like \"tell me when NVDA drops below $150\".",
          suggestions: ["Alert me when NVDA drops below $150", "Alert me when AAPL hits $250"],
        };
      }
      const lines = alerts.map((a) => `• ${a.symbol} ${a.direction === "above" ? "reaches" : "falls to"} $${a.threshold}`);
      return {
        intent: "reply",
        message: [`You have ${alerts.length} alert${alerts.length === 1 ? "" : "s"} running:`, ...lines, "Say \"cancel the <ticker> alert\" any time."].join("\n"),
        suggestions: alerts.slice(0, 3).map((a) => `Cancel the ${a.symbol} alert`),
      };
    }
    case "cancel_alert": {
      if (!ctx.userId) return { intent: "reply", message: "I couldn't reach your alerts just now — try again in a moment." };
      const alerts = (await listAlerts(ctx.userId).catch(() => [])).filter((a) => a.active);
      if (alerts.length === 0) return { intent: "reply", message: "There are no alerts to cancel — you don't have any running." };
      if (turn.all) {
        await Promise.all(alerts.map((a) => deleteAlert(ctx.userId as string, a.id).catch(() => {})));
        return { intent: "reply", message: `Cleared all ${alerts.length} alert${alerts.length === 1 ? "" : "s"}. Nothing is being watched now.` };
      }
      const sym = (turn.symbol ?? "").toUpperCase();
      const matches = alerts.filter((a) => a.symbol === sym);
      if (matches.length === 0) {
        return {
          intent: "reply",
          message: sym ? `You don't have an alert on ${sym}. Running right now: ${alerts.map((a) => a.symbol).join(", ")}.` : `Which one? You have alerts on ${alerts.map((a) => a.symbol).join(", ")}.`,
          suggestions: alerts.slice(0, 3).map((a) => `Cancel the ${a.symbol} alert`),
        };
      }
      if (matches.length > 1) {
        return {
          intent: "reply",
          message: `You have ${matches.length} ${sym} alerts: ${matches.map((a) => `${a.direction} $${a.threshold}`).join(", ")}. Want me to drop all of them?`,
          suggestions: [`Cancel all my ${sym} alerts`],
        };
      }
      await deleteAlert(ctx.userId, matches[0].id);
      return { intent: "reply", message: `Done. The ${sym} alert (${matches[0].direction} $${matches[0].threshold}) is off.` };
    }
    case "inbox": {
      if (!ctx.userId) return { intent: "reply", message: "I couldn't read your notifications just now — try again in a moment." };
      const [items, unread] = await Promise.all([
        listNotifications(ctx.userId, 8).catch(() => []),
        unreadCount(ctx.userId).catch(() => 0),
      ]);
      if (items.length === 0) {
        return { intent: "reply", message: "Your inbox is empty. Nothing happened while you were away." };
      }
      if (turn.markRead && unread > 0) await markAllRead(ctx.userId, Math.floor(Date.now() / 1000)).catch(() => {});
      const lines = items.slice(0, 5).map((n) => `• ${n.title}${n.body ? ` — ${n.body}` : ""} (${relTime(n.createdAt)})`);
      const head = unread > 0
        ? `${unread} unread${turn.markRead ? ", marking them read now" : ""}. The latest:`
        : "Nothing unread. The latest from your account:";
      return { intent: "reply", message: [head, ...lines].join("\n") };
    }
    case "autopilot_status": {
      if (!ctx.userId) return { intent: "reply", message: "I couldn't read your autopilot just now — try again in a moment." };
      const [cfg, runs] = await Promise.all([
        getAutopilot(ctx.userId).catch(() => null),
        listRuns(ctx.userId, 5).catch(() => []),
      ]);
      if (!cfg) {
        return {
          intent: "reply",
          message: "Autopilot isn't set up yet. Tell me an amount, how often, and how bold, like \"$25 weekly, balanced\", and I'll fill the form for you to authorize.",
          suggestions: ["$25 weekly, balanced", "$50 monthly, careful"],
        };
      }
      // Contribution pacing: what's actually gone in, and the forward rate.
      // NEVER project value or returns — the app tracks no cost basis.
      const contributed = runs.filter((r) => r.status === "success").reduce((n, r) => n + r.amountUsd, 0);
      const weeksRunning = Math.max(1, Math.round((Date.now() / 1000 - cfg.createdAt) / (7 * 86_400)));
      const perMonth = cfg.cadence === "daily" ? cfg.amountUsd * 30 : cfg.cadence === "weekly" ? cfg.amountUsd * 4.33 : cfg.cadence === "biweekly" ? cfg.amountUsd * 2.17 : cfg.amountUsd;
      const lines = [
        `Autopilot is ${cfg.active ? "ON" : "paused"}: $${cfg.amountUsd} ${cfg.cadence}, risk ceiling ${(cfg.riskCeilingBps / 100).toFixed(0)}.`,
        cfg.goal ? `Your goal, in your words: "${cfg.goal}".` : "",
        cfg.active ? `Next run: ${new Date(cfg.nextRunAt * 1000).toUTCString().slice(0, 16)}.` : "It won't run again until you start it.",
        `${cfg.runs} run${cfg.runs === 1 ? "" : "s"} over ${weeksRunning} week${weeksRunning === 1 ? "" : "s"}${contributed > 0 ? `, about $${contributed.toFixed(2)} contributed so far` : ""}${cfg.lastRunAt ? `, last one ${relTime(cfg.lastRunAt)}` : ""}.`,
        cfg.active ? `At this pace that's roughly $${perMonth.toFixed(0)}/month going in. That's contributions, not returns; I don't predict value.` : "",
      ].filter(Boolean);
      if (runs.length) {
        lines.push("Recent runs:");
        for (const r of runs.slice(0, 3)) {
          const what = r.status === "success"
            ? `bought $${r.amountUsd.toFixed(2)}${r.holdings?.length ? ` across ${r.holdings.length} names` : ""}`
            : r.status === "skipped" ? `skipped${r.reason ? ` (${r.reason})` : ""}` : `failed${r.reason ? ` (${r.reason})` : ""}`;
          lines.push(`• ${relTime(r.ranAt)} — ${what}`);
        }
      }
      return {
        intent: "reply",
        message: lines.join("\n"),
        suggestions: cfg.active ? ["Stop my autopilot"] : ["Open autopilot"],
      };
    }
    case "autopilot_stop": {
      if (!ctx.userId) return { intent: "reply", message: "I couldn't reach your autopilot just now — try again in a moment." };
      const cfg = await getAutopilot(ctx.userId).catch(() => null);
      if (!cfg) return { intent: "reply", message: "There's no autopilot running to stop." };
      if (!cfg.active) return { intent: "reply", message: "Autopilot is already paused. It won't run until you start it again." };
      // Pausing only ever REDUCES what's authorized, so it's safe to do server-side.
      await upsertAutopilot({ ...cfg, active: false });
      return {
        intent: "reply",
        message: `Stopped. Autopilot won't run again until you start it. Your ${cfg.runs} completed run${cfg.runs === 1 ? "" : "s"} and everything it bought stay exactly as they are.`,
        suggestions: ["Open autopilot"],
      };
    }
    case "price_history": {
      const sym = turn.symbol.toUpperCase();
      if (!SYMBOLS.has(sym)) return { intent: "reply", message: `${sym} isn't in the tradable universe here.` };
      const range = (turn.range ?? "1M") as MarketRange;
      const hist = await getHistory(sym, range).catch(() => null);
      if (!hist || hist.series.length < 2) {
        return { intent: "reply", message: `I don't have public price history for ${sym} — some tokenized listings have none yet. I can still quote its live price.` };
      }
      const label = range === "1W" ? "the past week" : range === "1Y" ? "the past year" : "the past month";
      const first = hist.series[0];
      const last = hist.series[hist.series.length - 1];
      const lo = Math.min(...hist.series);
      const hi = Math.max(...hist.series);
      const dir = hist.changePct >= 0 ? "up" : "down";
      const name = displayFor(sym).name || sym;
      const parts = [
        `${name} is ${dir} ${Math.abs(hist.changePct).toFixed(1)}% over ${label}: $${first.toFixed(2)} then, $${last.toFixed(2)} now.`,
        `Range over that stretch: $${lo.toFixed(2)} to $${hi.toFixed(2)}.`,
      ];
      if (hist.meta?.fiftyTwoWeekLow && hist.meta.fiftyTwoWeekHigh) {
        parts.push(`Its 52-week band is $${hist.meta.fiftyTwoWeekLow.toFixed(2)}–$${hist.meta.fiftyTwoWeekHigh.toFixed(2)}.`);
      }
      parts.push("History is what happened, not what will.");
      return { intent: "reply", message: parts.join(" "), suggestions: [`Buy $25 of ${sym}`, `Open ${sym}`] };
    }
    case "compare": {
      const syms = [...new Set(turn.symbols.map((x) => x.toUpperCase()))].filter((x) => SYMBOLS.has(x));
      if (syms.length < 2) return { intent: "reply", message: "I need two symbols from the tradable universe to compare." };
      const stats = await universeStatsRows(syms).catch(() => []);
      const hist = await Promise.all(syms.map((x) => getHistory(x, "1M").catch(() => null)));
      const rows = syms.map((sym, i) => {
        const st = stats.find((r) => r.symbol === sym);
        const h = hist[i];
        const bits = [`${displayFor(sym).name || sym} (${sym})`];
        if (h) bits.push(`${h.changePct >= 0 ? "+" : ""}${h.changePct.toFixed(1)}% past month`);
        if (st?.ret1yPct !== null && st?.ret1yPct !== undefined) bits.push(`${st.ret1yPct >= 0 ? "+" : ""}${st.ret1yPct.toFixed(0)}% past year`);
        if (st?.volPct !== null && st?.volPct !== undefined) bits.push(`${st.volPct.toFixed(0)}% volatility`);
        if (st?.maxDrawdownPct !== null && st?.maxDrawdownPct !== undefined) bits.push(`worst dip −${st.maxDrawdownPct.toFixed(0)}%`);
        return "• " + bits.join(" · ");
      });
      const steadier = stats.filter((r) => typeof r.volPct === "number").sort((a, b) => (a.volPct as number) - (b.volPct as number))[0];
      const tail = steadier ? `\n${steadier.symbol} has been the steadier one: lower swings, not necessarily better returns.` : "";
      return { intent: "reply", message: [`Here's how they stack up:`, ...rows].join("\n") + tail, suggestions: syms.map((x) => `Buy $25 of ${x}`) };
    }
    case "my_activity": {
      if (!ctx.address) {
        return { intent: "reply", message: "I can't read your on-chain history just now — the Activity panel has every transaction with its receipt." };
      }
      const rows = await getUserActivityServer(ctx.address as `0x${string}`).catch(() => []);
      if (rows.length === 0) {
        return { intent: "reply", message: "You haven't placed anything through me yet: no invests recorded on-chain for this wallet. Tell me a goal and we can change that.", suggestions: ["Grow it over a few years", "Play it safe, still earn"] };
      }
      const total = rows.reduce((n, r) => n + r.usdc, 0);
      const lines = rows.slice(0, 4).map((r) => `• $${r.usdc.toFixed(2)} across ${r.legCount} holding${r.legCount === 1 ? "" : "s"} — ${EXPLORER}${r.txHash}`);
      return {
        intent: "reply",
        message: [
          `You've placed ${rows.length} plan${rows.length === 1 ? "" : "s"} through me, $${total.toFixed(2)} in total. The most recent:`,
          ...lines,
          "Every one was signed and recorded on-chain before the money moved.",
        ].join("\n"),
        suggestions: ["Review my portfolio", "Open activity"],
      };
    }
    case "themes": {
      const slug = (turn.slug ?? "").toLowerCase();
      if (slug) {
        const def = getThemeDef(slug);
        const payload = await getPublicThemes().catch(() => null);
        const theme = payload?.themes.find((t) => t.slug === slug);
        if (!def || !theme) {
          return { intent: "reply", message: `I don't have a "${slug}" theme. Mine are: ${THEME_DEFS.map((d) => d.name).join(", ")}.`, suggestions: THEME_DEFS.slice(0, 3).map((d) => `What's in your ${d.name} theme?`) };
        }
        const holdings = theme.allocations.map((c) => `${c.symbol} ${Math.round(c.weightPct)}%`).join(" · ");
        return {
          intent: "reply",
          message: [`${def.name}: ${def.tagline}`, `The basket: ${holdings}`, theme.backtest ? `Walk-forward tested: ${theme.backtest.portfolio.returnPct >= 0 ? "+" : ""}${theme.backtest.portfolio.returnPct.toFixed(1)}% over the window against ${theme.backtest.benchmark.returnPct >= 0 ? "+" : ""}${theme.backtest.benchmark.returnPct.toFixed(1)}% for the S&P, worst dip −${Math.abs(theme.backtest.portfolio.maxDrawdownPct).toFixed(1)}%. History, not a promise.` : ""].filter(Boolean).join("\n"),
          suggestions: [`Invest $50 in ${def.name}`],
        };
      }
      return {
        intent: "reply",
        message: ["I keep verified baskets for the themes people ask about most:", ...THEME_DEFS.map((d) => `• ${d.name} — ${d.tagline}`), "Ask about any of them and I'll show the holdings and how it has held up."].join("\n"),
        suggestions: THEME_DEFS.slice(0, 3).map((d) => `What's in your ${d.name} theme?`),
      };
    }
    case "strategies": {
      const payload = await getPublicStrategies().catch(() => null);
      if (!payload?.strategies?.length) {
        return { intent: "reply", message: "My model portfolios aren't loading right now — try again in a minute." };
      }
      const lines = payload.strategies.map((st) => {
        const bt = st.backtest ? ` — ${st.backtest.portfolio.returnPct >= 0 ? "+" : ""}${st.backtest.portfolio.returnPct.toFixed(1)}% over the test window, worst dip −${Math.abs(st.backtest.portfolio.maxDrawdownPct).toFixed(1)}%` : "";
        return `• ${st.name}: ${st.tagline}${bt}`;
      });
      return {
        intent: "reply",
        message: ["My named strategies: fixed rules, walk-forward tested, no hand-picking.", ...lines, "Tell me which one and how much, and I'll build it for you."].join("\n"),
        suggestions: payload.strategies.slice(0, 3).map((st) => `Invest $50 in ${st.name}`),
      };
    }
    case "grove_list": {
      const payload = await getGroves().catch(() => null);
      return {
        intent: "grove_list",
        message: turn.message ?? "My Groves — curated stock baskets bought straight into your wallet at published weights. $0 to enter, hold, or rebalance; the only fee is 10% of profit when you exit. Tap one for what's inside.",
        groves: GROVES.map((g) => {
          const bt = payload?.groves.find((x) => x.id === g.id)?.backtest ?? null;
          return {
            // The min shown on the shelf is the one THIS chat path enforces —
            // in preview that's the smallest-slice floor, not the launch min.
            id: g.id, name: g.name, ticker: g.ticker, thesis: g.thesis, minBuyUsd: groveChatMin(g),
            returnPct: bt?.portfolio.returnPct ?? null,
            spyPct: bt?.benchmark.returnPct ?? null,
          };
        }),
      };
    }
    case "grove_info": {
      const g = resolveGrove(turn.groveId);
      if (!g) return unknownGroveReply(turn.groveId);
      const bt = (await getGroves().catch(() => null))?.groves.find((x) => x.id === g.id)?.backtest ?? null;
      const holdings = g.components.map((c) => `${c.symbol} ${c.weightBps / 100}%`).join(" · ");
      return {
        intent: "reply",
        message: [
          `${g.name} (${g.ticker}): ${g.thesis}`,
          `The basket, ${g.components.length} names: ${holdings}`,
          bt ? `Past year: ${bt.portfolio.returnPct >= 0 ? "+" : ""}${bt.portfolio.returnPct.toFixed(1)}% vs ${bt.benchmark.returnPct >= 0 ? "+" : ""}${bt.benchmark.returnPct.toFixed(1)}% for the S&P 500, worst dip −${Math.abs(bt.portfolio.maxDrawdownPct).toFixed(1)}%. History, not a promise.` : "",
          `Fees: $0 to enter, hold, or rebalance — only 10% of profit when you exit, measured against your own cost basis. Full composition, exclusions, and methodology: monvera.best/groves/${g.id}`,
        ].filter(Boolean).join("\n"),
        suggestions: [`Buy $${groveChatMin(g)} of ${g.name}`, "What Groves do you have?"],
      };
    }
    case "grove_buy": {
      const g = resolveGrove(turn.groveId);
      if (!g) return unknownGroveReply(turn.groveId);
      // TODO(GroveManager): when the contract deploys (NEXT_PUBLIC_GROVE_MANAGER
      // set), this becomes a single GroveManager.buy() — on-chain cost basis,
      // exit-fee tracking, and no per-leg venue floor. Until then the buy runs
      // per-leg through the existing invest rails (preview mode), which is why
      // the smallest weighted slice must clear the $11 venue minimum below.
      const chatMin = groveChatMin(g);
      const cash = Math.floor(ctx.cashUsd ?? 0);
      const amount = turn.amountUsd !== undefined ? Math.floor(turn.amountUsd) : undefined;
      if (amount === undefined) {
        const sizes = [chatMin, chatMin * 2].filter((v) => v <= cash);
        if (cash >= chatMin && !sizes.includes(cash)) sizes.push(cash);
        return {
          intent: "reply",
          message: `How much should go into the ${g.name}? Buying it here places each of its ${g.components.length} names as its own order, so it needs at least $${chatMin}. You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash.`,
          suggestions: [...new Set(sizes)].slice(0, 4).map((v) => `Buy $${v} of ${g.name}`),
        };
      }
      if (amount < chatMin) {
        return {
          intent: "reply",
          message: chatMin > g.minBuyUsd
            ? `Until the GroveManager contract is live, buying the ${g.name} places each name as its own order — the smallest slice (${Math.min(...g.components.map((c) => c.weightBps)) / 100}%) needs $${MIN_LEG_USD}, which puts the minimum here at $${chatMin}. The published $${g.minBuyUsd} minimum applies at launch.`
            : `The ${g.name} needs at least $${g.minBuyUsd} so every slice clears the $${MIN_LEG_USD} venue minimum.`,
          suggestions: cash >= chatMin ? [`Buy $${chatMin} of ${g.name}`] : undefined,
        };
      }
      if (amount > cash) {
        return {
          intent: "reply",
          message: `You have $${(ctx.cashUsd ?? 0).toFixed(2)} in cash, so $${amount} won't clear. Size it down?`,
          suggestions: cash >= chatMin ? [`Buy $${cash} of ${g.name}`] : undefined,
        };
      }
      const allocations = g.components.map((c) => ({ symbol: c.symbol, weightPct: c.weightBps / 100, reason: c.reason.slice(0, 200) }));
      const backtest = await backtestBasket(allocations).catch(() => null);
      return {
        intent: "plan",
        message: `The ${g.name} is ready: $${amount} across ${g.components.length} names at the published weights, nothing substituted. Entering costs nothing extra — the only fee is 10% of profit when you exit. Look it over, then invest.`,
        payload: {
          summary: `${g.name} (${g.ticker}) — ${g.thesis}`,
          rationale: g.longThesis,
          riskScore: GROVE_RISK_BPS[g.id] ?? 6000,
          allocations,
          backtest,
          amountUsd: amount,
          model: "grove",
          grove: { id: g.id, name: g.name },
        },
      };
    }
    case "grove_auto": {
      const g = resolveGrove(turn.groveId);
      if (!g) return unknownGroveReply(turn.groveId);
      // TODO(GroveManager): at deploy, wire enable/disable to the contract's
      // auto-manage authorization (on-chain caps) instead of this preview note.
      if (!g.launched) {
        return {
          intent: "reply",
          message: turn.action === "enable"
            ? `Auto-manage for the ${g.name} opens when its contract deploys — the hourly drift checks aren't live yet, and I won't pretend to flip a switch that doesn't exist. You can buy the basket today, and auto-manage can be added to your position at launch.`
            : `There's nothing to switch off — auto-manage for the ${g.name} isn't live yet. It opens when its contract deploys.`,
          suggestions: [`Buy $${groveChatMin(g)} of ${g.name}`, `What's in the ${g.name}?`],
        };
      }
      return { intent: "reply", message: `Auto-manage changes for the ${g.name} aren't wired into chat yet — manage them from monvera.best/groves/${g.id}.` };
    }
    case "watchlist": {
      if (!ctx.userId) return { intent: "reply", message: "I couldn't reach your watchlist just now — try again in a moment." };
      const sym = (turn.symbol ?? "").toUpperCase();
      if (turn.action === "add" || turn.action === "remove") {
        if (!SYMBOLS.has(sym)) return { intent: "reply", message: `${sym || "That"} isn't in the tradable universe here.` };
        if (turn.action === "add") {
          await addWatch(ctx.userId, sym, Math.floor(Date.now() / 1000)).catch(() => {});
          return { intent: "reply", message: `${sym} is on your watchlist. Want a price alert on it too?`, suggestions: [`Alert me when ${sym} drops 10%`] };
        }
        await removeWatch(ctx.userId, sym).catch(() => {});
        return { intent: "reply", message: `Removed ${sym} from your watchlist.` };
      }
      const list = await listWatchlist(ctx.userId).catch(() => []);
      if (list.length === 0) {
        return { intent: "reply", message: "Your watchlist is empty. Say \"watch NVDA\" and I'll add it.", suggestions: ["Watch NVDA", "Watch AAPL"] };
      }
      return {
        intent: "reply",
        message: `You're watching ${list.length}: ${list.join(", ")}. Ask how any of them has done, or say \"unwatch <ticker>\".`,
        suggestions: list.slice(0, 3).map((x) => `How has ${x} done this month?`),
      };
    }
    case "buyback": {
      const data = await getBuybackData().catch(() => null);
      if (!data) return { intent: "reply", message: "The buyback numbers aren't loading right now — the Buyback page has the live dashboard." };
      const st = data.stats;
      return {
        intent: "reply",
        message: [
          `Revenue funds $MONVERA buybacks: $${st.totalRevenue.toFixed(2)} earned, $${st.totalExpenses.toFixed(2)} spent on running costs, leaving $${st.netRevenue.toFixed(2)} net.`,
          `${st.buybackPct}% of that is the buyback budget, $${st.buybackBudget.toFixed(2)}, of which $${st.totalSpent.toFixed(2)} is already deployed across ${st.buybackCount} buy${st.buybackCount === 1 ? "" : "s"}${st.avgPrice ? ` at an average of $${st.avgPrice.toFixed(6)}` : ""}.`,
          `The treasury holds ${st.treasuryMonvera.toLocaleString("en-US", { maximumFractionDigits: 0 })} $MONVERA and $${st.treasuryUsdg.toFixed(2)} USDG, and every buy is on-chain.`,
        ].join("\n"),
      };
    }
    case "liquidity": {
      const sym = turn.symbol.toUpperCase();
      if (sym === "MONVERA") return { intent: "reply", message: "$MONVERA trades on its own route and is always buyable in the app — gasless, like everything else.", suggestions: ["Buy $25 of MONVERA"] };
      if (!SYMBOLS.has(sym)) return { intent: "reply", message: `${sym} isn't in the tradable universe here.` };
      const ok = await isTradable(sym).catch(() => true);
      if (ok) return { intent: "reply", message: `Yes, ${displayFor(sym).name || sym} is fillable right now. How much would you like?`, suggestions: [`Buy $25 of ${sym}`, `Buy $50 of ${sym}`] };
      const alts = await liquidSuggestions(sym).catch(() => []);
      return {
        intent: "reply",
        message: `Not right now. ${sym} is listed but no venue can fill it at the moment, which happens when maker inventory runs dry. It usually comes back.`,
        suggestions: alts.map((a) => `Buy $25 of ${a}`),
      };
    }
    case "screener": {
      const metric = turn.metric ?? "gainers";
      const stats = await universeStatsRows([...SYMBOLS]).catch(() => []);
      const usable = stats.filter((r) => !r.noData);
      if (usable.length === 0) return { intent: "reply", message: "The ranking data isn't loading right now — try again shortly." };
      let rows: typeof usable;
      let head: string;
      if (metric === "steady") {
        rows = usable.filter((r) => typeof r.volPct === "number").sort((a, b) => (a.volPct as number) - (b.volPct as number)).slice(0, 5);
        head = "The steadiest names in the universe (lowest year volatility):";
      } else if (metric === "volatile") {
        rows = usable.filter((r) => typeof r.volPct === "number").sort((a, b) => (b.volPct as number) - (a.volPct as number)).slice(0, 5);
        head = "The wildest movers by year volatility. These swing hard both ways:";
      } else if (metric === "losers") {
        rows = usable.filter((r) => typeof r.ret1yPct === "number").sort((a, b) => (a.ret1yPct as number) - (b.ret1yPct as number)).slice(0, 5);
        head = "Weakest over the past year:";
      } else {
        rows = usable.filter((r) => typeof r.ret1yPct === "number").sort((a, b) => (b.ret1yPct as number) - (a.ret1yPct as number)).slice(0, 5);
        head = "Strongest over the past year:";
      }
      const lines = rows.map((r) => {
        const bits: string[] = [];
        if (typeof r.ret1yPct === "number") bits.push(`${r.ret1yPct >= 0 ? "+" : ""}${r.ret1yPct.toFixed(0)}% 1y`);
        if (typeof r.volPct === "number") bits.push(`${r.volPct.toFixed(0)}% vol`);
        return `• ${displayFor(r.symbol).name || r.symbol} (${r.symbol}) — ${bits.join(" · ")}`;
      });
      return {
        intent: "reply",
        message: [head, ...lines, "Past performance is history, not a forecast. A strong year is not a reason on its own."].join("\n"),
        suggestions: rows.slice(0, 2).map((r) => `Buy $25 of ${r.symbol}`),
      };
    }
    case "open": {
      const sym = turn.symbol ? turn.symbol.toUpperCase() : undefined;
      if (turn.target === "holding" && (!sym || !SYMBOLS.has(sym))) {
        return { intent: "reply", message: sym ? `${sym} isn't in the tradable universe here.` : "Which stock would you like to see?" };
      }
      // Say something WORTH saying about what just opened — "take a look" tells
      // the user nothing. The model's own line still wins when it wrote one.
      const OPEN_COPY: Record<string, string> = {
        portfolio: "Your portfolio: every holding at its live price, with the day's move on each. Tap any name for its full page.",
        market: "The whole market: ~95 real tokenized stocks and ETFs. Search by name or theme, tap anything to see it or trade it.",
        wallet: "Your wallet: cash, every holding, and every transfer in and out. Only you hold the keys.",
        token: "$MONVERA, the community's stake in me. Live price, your position, and the buyback that revenue funds.",
        autopilot: "Autopilot: set an amount, a cadence, and a risk ceiling once, authorize it, and I invest on schedule within those limits. Stop it any time, including by just telling me.",
        vera: "My track record: every plan committed on-chain before the money moved, with receipts anyone can check.",
        scan: "Scan: point the camera at any product and I'll find the listed companies behind it and build a plan around them.",
        activity: "Everything that's happened in your account, newest first, each with its on-chain receipt.",
        alerts: "Your price alerts. Tell me a level any time, like \"ping me if NVDA drops below $150\", and I'll watch it for you.",
        insights: "A read on your mix: concentration, themes, and how it's been behaving.",
        send: "The send sheet. Double-check the address before you confirm; transfers on-chain can't be undone.",
        receive: "Your deposit address. Send USDG on Robinhood Chain and it lands in seconds. This account is yours alone.",
        settings: "Settings: appearance, your avatar, and your key export. That last part stays strictly in your hands.",
      };
      const fallback = sym
        ? `${displayFor(sym).name || sym}: live chart, your position if you hold it, and everything I know about it.`
        : OPEN_COPY[turn.target] ?? "Opening that for you — take a look.";
      return { intent: "open", target: turn.target, symbol: sym, message: turn.message ?? fallback };
    }
    default:
      return { intent: "reply", message: turn.message, suggestions: turn.suggestions };
  }
}

// ── rebalance: buy-only top-ups toward a fresh target mix ────────────────────
// The invest rails only BUY (sells are manual by design), so a rebalance here
// means: pick a target mix that accounts for what the user already holds, then
// spend their available cash on the underweight names. Every leg clears the
// $11 venue floor or is dropped and the rest renormalized.
const MIN_LEG_USD = 11;
const EXPLORER = "https://robinhoodchain.blockscout.com/tx/";

// ── groves: chat-side helpers ────────────────────────────────────────────────

/** Match "tayyib", "$TITAN", "Silicon Grove", "rails" → the registry entry. */
function resolveGrove(raw: string): GroveDef | undefined {
  const v = raw.trim().toLowerCase().replace(/^\$/, "").replace(/\s+grove$/, "");
  return GROVES.find(
    (g) => g.id === v || g.ticker.slice(1).toLowerCase() === v || g.name.toLowerCase().replace(/\s+grove$/, "") === v,
  );
}

function unknownGroveReply(raw: string): VeraResult {
  return {
    intent: "reply",
    message: `I don't have a "${raw}" Grove. The four: ${GROVES.map((g) => `${g.name} (${g.ticker})`).join(", ")}.`,
    suggestions: ["What Groves do you have?"],
  };
}

/** In preview the buy runs per-leg on the venue rails, so the SMALLEST weighted
 *  slice must clear the $11 floor — that can sit above the published minBuyUsd.
 *  Shared formula (lib/groves) so the pages can never disagree with chat; the
 *  GroveManager path removes this (see the TODO in grove_buy). */
const groveChatMin = grovePreviewMinUsd;

// Fixed, honest risk scores (bps, 0-10000) for the plan card's meter — the
// sector-concentrated and crypto-beta baskets sit above the diversified cores.
const GROVE_RISK_BPS: Record<string, number> = { tayyib: 5500, titan: 5000, silic: 7000, rails: 8500 };

/** "3 days ago" from a unix-SECONDS timestamp (what D1 and the chain store). */
function relTime(sec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (diff < 90) return "just now";
  const mins = Math.round(diff / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

// ── sell: chat-native, symmetrical with invest ───────────────────────────────
// One leg or the whole portfolio: legs are sized from the LIVE holdings in
// context, gated through tradability, floored at the venue minimum, and
// snapped to the full position when the ask is close enough that leftovers
// would just be dust. $MONVERA never rides these rails (its own route).
async function sellPlan(ctx: VeraContext, symbolRaw?: string, amountUsd?: number, all?: boolean): Promise<VeraResult> {
  const held = (ctx.holdings ?? []).filter((h) => (h.valueUsd ?? 0) > 0.5 && h.symbol !== "MONVERA");
  if (held.length === 0) {
    return { intent: "reply", message: "You don't hold any stocks to sell. Your cash is already cash." };
  }

  // Whole-portfolio cash out.
  if (!symbolRaw) {
    if (!all) {
      return {
        intent: "reply",
        message: "Which holding should I sell? Or I can cash out everything.",
        suggestions: [...held.slice(0, 3).map((h) => `Sell my ${h.symbol}`), "Sell everything"].slice(0, 4),
      };
    }
    const { ok } = await filterTradable(held.map((h) => h.symbol)).catch(() => ({ ok: held.map((h) => h.symbol) }));
    const okSet = new Set(ok);
    const legs = held
      .filter((h) => okSet.has(h.symbol))
      .map((h) => ({ symbol: h.symbol, amountUsd: Math.round((h.valueUsd ?? 0) * 100) / 100, all: true }));
    const skipped = held.filter((h) => !okSet.has(h.symbol)).map((h) => h.symbol);
    if (legs.length === 0) {
      return { intent: "reply", message: "No venue can fill any of your holdings right now — that happens when maker inventory runs dry. Try again in a few minutes." };
    }
    const totalUsd = legs.reduce((n, l) => n + l.amountUsd, 0);
    return {
      intent: "sell_plan",
      message: [
        `The cash-out: ${legs.length} holding${legs.length === 1 ? "" : "s"}, about $${totalUsd.toFixed(2)} back to cash, each sold at a live quote.`,
        skipped.length ? `(${skipped.join(", ")} can't be filled right now, so I left ${skipped.length === 1 ? "it" : "them"} out. Sell later.)` : "",
        "Look it over, then confirm below.",
      ].filter(Boolean).join(" "),
      legs,
      totalUsd,
    };
  }

  // Single-name sell.
  const symbol = symbolRaw.toUpperCase();
  const holding = held.find((h) => h.symbol === symbol);
  if (!holding) {
    return {
      intent: "reply",
      message: `You don't hold any ${symbol}. You hold: ${held.map((h) => h.symbol).join(", ")}.`,
      suggestions: held.slice(0, 3).map((h) => `Sell my ${h.symbol}`),
    };
  }
  const posUsd = holding.valueUsd ?? 0;
  if (!(await isTradable(symbol).catch(() => true))) {
    return { intent: "reply", message: `${symbol} can't be filled right now: no venue has inventory for it. It usually comes back within minutes.` };
  }
  let amount = all ? posUsd : amountUsd;
  if (amount === undefined) {
    const half = Math.floor(posUsd / 2);
    const opts = [
      ...(half >= MIN_LEG_USD ? [`Sell $${half} of ${symbol} (half)`] : []),
      `Sell all my ${symbol} ($${posUsd.toFixed(0)})`,
    ];
    return {
      intent: "reply",
      message: `How much ${symbol}? You hold about $${posUsd.toFixed(2)} worth.`,
      suggestions: opts.slice(0, 4),
    };
  }
  if (amount > posUsd + 0.01) {
    return {
      intent: "reply",
      message: `You hold about $${posUsd.toFixed(2)} of ${symbol}, so $${amount.toFixed(0)} is more than the position. Sell all of it?`,
      suggestions: [`Sell all my ${symbol}`],
    };
  }
  // Snap to the whole position when the remainder would be dust.
  const wholePosition = all || amount >= posUsd * 0.95;
  amount = wholePosition ? posUsd : amount;
  if (amount < MIN_LEG_USD) {
    return {
      intent: "reply",
      message: `A sell needs at least $${MIN_LEG_USD}, the venue minimum. Your ${symbol} position is $${posUsd.toFixed(2)}${posUsd >= MIN_LEG_USD ? `. Want to sell $${MIN_LEG_USD} or all of it?` : ", which is under the floor. It can be sold whole once it's worth more."}`,
      suggestions: posUsd >= MIN_LEG_USD ? [`Sell $${MIN_LEG_USD} of ${symbol}`, `Sell all my ${symbol}`] : undefined,
    };
  }
  const amt = Math.round(amount * 100) / 100;
  return {
    intent: "sell_plan",
    message: `Ready to sell ${wholePosition ? `your whole ${symbol} position` : `$${amt.toFixed(2)} of ${symbol}`} back to cash at a live quote. Confirm below and I'll place it. Gas is on us.`,
    legs: [{ symbol, amountUsd: amt, all: wholePosition }],
    totalUsd: amt,
  };
}

async function rebalancePlan(ctx: VeraContext, tilt?: string): Promise<VeraResult> {
  const cash = Math.floor(ctx.cashUsd ?? 0);
  const held = (ctx.holdings ?? []).filter((h) => (h.valueUsd ?? 0) > 0 && h.symbol !== "MONVERA");
  if (held.length === 0) {
    return { intent: "reply", message: "You don't hold any stocks yet, so there's nothing to rebalance — tell me a goal and I'll build your first plan instead." };
  }
  if (cash < MIN_LEG_USD) {
    return { intent: "reply", message: `Rebalancing here works by topping up your underweight names with cash, and you have $${(ctx.cashUsd ?? 0).toFixed(2)} available — a single top-up needs at least $${MIN_LEG_USD}. Add some cash, or sell a slice manually from any holding's page first.` };
  }

  const heldUsd = held.reduce((s2, h) => s2 + (h.valueUsd ?? 0), 0);
  const heldLine = held.map((h) => `${h.symbol} $${(h.valueUsd ?? 0).toFixed(0)}`).join(", ");
  const goal = [
    `Rebalance an existing portfolio. Current holdings (market value): ${heldLine}. Total invested $${heldUsd.toFixed(0)}, new cash to deploy $${cash}.`,
    `Propose the TARGET mix for the whole portfolio (existing + new cash)${tilt ? `, tilted: ${tilt}` : ""}. Prefer keeping existing names unless the tilt says otherwise.`,
  ].join(" ");

  const target = await buildAllocation(goal, heldUsd + cash);

  // Buy-only deltas: how far each target name is BELOW its target dollars.
  // Liquidity-gated: a top-up leg no venue can fill would just die at invest
  // time, so drop dead symbols before sizing.
  const { ok: liveSyms } = await filterTradable(target.allocations.map((a) => a.symbol));
  const liveSet = new Set(liveSyms);
  const total = heldUsd + cash;
  const currentBy = new Map(held.map((h) => [h.symbol, h.valueUsd ?? 0]));
  const deltas = target.allocations
    .filter((a) => liveSet.has(a.symbol))
    .map((a) => ({
      symbol: a.symbol,
      reason: a.reason,
      gapUsd: Math.max(0, (a.weightPct / 100) * total - (currentBy.get(a.symbol) ?? 0)),
    }))
    .filter((d) => d.gapUsd > 0);
  const gapSum = deltas.reduce((s2, d) => s2 + d.gapUsd, 0);
  if (gapSum <= 0) {
    return { intent: "reply", message: "Your mix is already very close to where I'd put it — nothing worth topping up right now." };
  }
  // Scale gaps to the cash actually available, then drop sub-$11 legs and renormalize.
  let legs = deltas.map((d) => ({ ...d, usd: (d.gapUsd / gapSum) * cash }));
  for (;;) {
    const drop = legs.filter((l) => l.usd < MIN_LEG_USD);
    if (drop.length === 0 || legs.length <= 1) break;
    legs = legs.filter((l) => l.usd >= MIN_LEG_USD);
    const kept = legs.reduce((s2, l) => s2 + l.usd, 0);
    legs = legs.map((l) => ({ ...l, usd: (l.usd / kept) * cash }));
  }
  if (legs.length === 0 || legs[0].usd < MIN_LEG_USD) {
    return { intent: "reply", message: `With $${cash} of cash the top-ups come out under the $${MIN_LEG_USD} venue minimum per name — add a bit more cash and I'll spread it properly.` };
  }

  const allocations = legs.map((l) => ({
    symbol: l.symbol,
    weightPct: Math.round((l.usd / cash) * 10000) / 100,
    reason: `Tops up toward target — ${l.reason}`.slice(0, 200),
  }));
  const backtest = await backtestBasket(allocations).catch(() => null);
  return {
    intent: "plan",
    message: `Here's the rebalance — your $${cash} goes to the names furthest under target${tilt ? ` (${tilt})` : ""}. Invest it and your whole mix moves toward: ${target.summary.toLowerCase().replace(/\.$/, "")}.`,
    payload: {
      summary: `Rebalance top-up — ${target.summary}`,
      rationale: target.rationale,
      riskScore: target.riskScore,
      allocations,
      backtest,
      amountUsd: cash,
      model: activeModelId(),
    },
  };
}
