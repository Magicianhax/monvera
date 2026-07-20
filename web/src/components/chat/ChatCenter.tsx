"use client";

// Chat center — the conversation with Vera (the "Monvera Chat" design's CHAT
// surface). Greeting + live portfolio card, goal → THINK → proposed plan card,
// nudges, invest → success card, and the composer. History persists via
// useVeraChat (D1); the intelligence runs on the real invest rails (useInvest)
// and the numbers come from the real portfolio (usePortfolio) — no mock data.
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useInvest } from "@/hooks/useInvest";
import { useSellAll, type SellSelection, type SellSuccess } from "@/hooks/useSellAll";
import { useMonveraSwap } from "@/hooks/useMonveraSwap";
import { formatUnits, parseUnits } from "viem";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { usePortfolio, type Portfolio } from "@/hooks/useBalances";
import { catFor, displayFor, toTile } from "@/lib/displayAssets";
import { AssetTile, Confetti, RiskMeter } from "@/components/design";
import type { useVeraChat } from "@/hooks/useVeraChat";
import type { AllocateResult, InvestSuccess } from "@/lib/invest-types";
import { authHeader } from "@/lib/authedFetch";
import { setAutopilotPrefill, setOrderAmountPrefill, consumeAdoptedPlan } from "./autopilotPrefill";
import { ChatOrb, PIcon, chartPaths, dcol, pctStr, usd, usd0, type ChatNav } from "./chatKit";
import { useAvatar, avatarCss } from "./avatar";
import { FAQ } from "@/lib/faq";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/hooks/useTheme";
import { useColorStyle } from "@/hooks/useColorStyle";
import { portfolioDayCurve } from "@/lib/portfolioCurve";
import { ConveyorOverlay } from "./ConveyorOverlay";
import { assetBySymbol } from "@/lib/tokens";

export interface ChatCenterHandle { submit: (text: string) => void }

// Neutral first (the turn might be a question, an order, anything) — the
// plan-flavored beats only appear deep into a long wait, which in practice
// means a plan or review is being built. Quick replies never reach them.
const THINK = ["Reading that…", "Thinking it through…", "Pulling the real numbers…", "Working out the details…", "Picking real companies…", "Balancing growth & safety…", "Almost there…"];

// Loading copy that matches the question — "switch to dark mode" should never
// say it's pulling market numbers. Cheap keyword routing, chosen at submit.
const THINK_TRACKS: { re: RegExp; beats: string[] }[] = [
  { re: /\b(dark|light|theme|palette|color|avatar|setting)/i, beats: ["On it…"] },
  { re: /\b(open|show me the|go to)\b/i, beats: ["Opening…"] },
  { re: /\b(alert|notification|inbox|watchlist|autopilot|missed|unread)\b/i, beats: ["Checking your account…", "One moment…"] },
  { re: /\b(price|market|moved|history|compare|vs\.?|gainers|losers|volatile|steadiest|quote|worth|get me)\b/i, beats: ["Checking live prices…", "Reading the tape…", "Almost there…"] },
  { re: /\b(what did i|my activity|track record|receipts|buyback|treasury)\b/i, beats: ["Reading the records…", "Checking on-chain…"] },
  { re: /\b(invest|plan|grow|safe|rebalance|buy|sell|cash out|scan|portfolio|grove|basket)\b/i, beats: THINK },
];
function thinkTrackFor(text: string): string[] {
  for (const t of THINK_TRACKS) if (t.re.test(text)) return t.beats;
  return ["Thinking…", "Almost there…"];
}
const THINK_STEP_MS = 1400;
const GREET = "Hey — I'm Vera. Here's where your money stands right now. Tell me a goal in your own words and I'll build a plan, or tap around to explore.";

type NudgeTone = "balanced" | "safer" | "bolder" | "simpler";
const NUDGES: [NudgeTone, string][] = [["balanced", "Balanced"], ["safer", "Safer"], ["bolder", "Bolder"], ["simpler", "Simpler"]];
const NUDGE_HINT: Record<NudgeTone, string> = {
  balanced: " — keep it balanced between growth and safety",
  safer: " — make it safer and steadier",
  bolder: " — make it bolder, tilted to growth",
  simpler: " — keep it simpler, with fewer holdings",
};
const NUDGE_RISK: Record<NudgeTone, "conservative" | "balanced" | "aggressive"> = {
  balanced: "balanced", safer: "conservative", bolder: "aggressive", simpler: "balanced",
};

const EXPLORER_TX = "https://robinhoodchain.blockscout.com/tx/";

// Friendly names for the re-open chips on "open" messages.
const OPEN_LABELS: Record<string, string> = {
  portfolio: "Portfolio", market: "Market", wallet: "Wallet", token: "$MONVERA",
  autopilot: "Autopilot", vera: "Track record", scan: "Scan", activity: "Activity",
  alerts: "Alerts", insights: "Insights", holding: "the stock", send: "Send",
  receive: "Deposit", settings: "Settings",
};

// Vera writes receipts and doc pointers as bare URLs; render them as real links
// (her text is otherwise plain, so every link she gave used to be dead text).
const URL_RE = /(https?:\/\/[^\s<>"')]+|(?:robinhoodchain\.blockscout\.com|docs\.monvera\.best|monvera\.best)\/[^\s<>"')]+)/g;

function Linkify({ text }: { text: string }) {
  // Vera writes light markdown emphasis; render **bold** instead of asterisks.
  const bold = text.split(/\*\*([^*\n]{1,80})\*\*/g);
  return (
    <>
      {bold.map((seg, bi) => {
        if (!seg) return null;
        const parts = seg.split(URL_RE);
        const body = parts.map((p, i) => {
          if (!p) return null;
          if (i % 2 === 0) return <span key={i}>{p}</span>;
          const href = p.startsWith("http") ? p : `https://${p}`;
          const label = p.replace(/^https?:\/\//, "");
          return (
            <a key={i} href={href} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontWeight: 600, wordBreak: "break-word" }}>
              {label.length > 46 ? label.slice(0, 30) + "…" + label.slice(-10) : label}
            </a>
          );
        });
        return bi % 2 === 1 ? <b key={`b${bi}`} style={{ fontWeight: 700 }}>{body}</b> : <span key={`s${bi}`}>{body}</span>;
      })}
    </>
  );
}

// GFM-style table support for Vera's replies: a run of `| … |` lines with a
// `|---|` separator renders as a real table (cells still get Linkify, so bold
// and links work inside). Everything else falls through to plain Linkify —
// this is block-splitting, not a markdown engine.
const isTableRow = (l: string | undefined): l is string =>
  !!l && /^\s*\|.*\|\s*$/.test(l);
const isSepRow = (l: string | undefined): boolean =>
  !!l && /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");
const splitRow = (l: string): string[] =>
  l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

// Memoized: message content is immutable, so re-renders driven by the composer
// (every keystroke re-renders ChatCenter) must not re-run the parse for the
// whole history.
const VeraRich = memo(function VeraRich({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let buf: string[] = [];
  let i = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push(<Linkify key={`t${out.length}`} text={buf.join("\n")} />);
    buf = [];
  };
  while (i < lines.length) {
    if (isTableRow(lines[i]) && isSepRow(lines[i + 1])) {
      const header = splitRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (isTableRow(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      // A blank line after the table would render as a full empty line under
      // the table's own margin (pre-wrap keeps it) — swallow one.
      if (lines[i] === "") i++;
      flush();
      out.push(
        <div key={`tb${out.length}`} style={{ overflowX: "auto", margin: "10px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: "min(100%, 320px)" }}>
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} style={{ textAlign: hi === 0 ? "left" : "right", padding: "6px 12px 6px 0", borderBottom: "1px solid var(--line)", color: "var(--ink-3)", fontWeight: 500, fontSize: 12, whiteSpace: "nowrap" }}>
                    <Linkify text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right", padding: "6px 12px 6px 0", borderBottom: "1px solid color-mix(in srgb, var(--line) 45%, transparent)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      <Linkify text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else {
      buf.push(lines[i]);
      i++;
    }
  }
  flush();
  return <>{out}</>;
});

/** Human token quantity from raw 18dp — whole numbers when big, precise when tiny. */
function fmtTok(raw: bigint): string {
  const n = Number(formatUnits(raw, 18));
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 6 });
}

/** One Grove on the shelf (veraRouter grove_list → payload.groveList). */
interface GroveListItem {
  id: string;
  name: string;
  ticker: string;
  thesis: string;
  minBuyUsd: number;
  returnPct: number | null;
  spyPct: number | null;
}

/** A grove-tagged plan payload — same AllocateResult the rails execute, plus
 *  which Grove it came from so the receipt can link back to /groves/<id>. */
type GrovePlan = AllocateResult & { grove?: { id: string; name: string } };

/** Persisted receipt for a chat-native $MONVERA fill (payload.tokenReceipt). */
interface TokenReceipt {
  side: "buy" | "sell";
  paid: string;
  received: string;
  min: string;
  txHash: string;
}

// Suggestion chips (design's suggestions; each submits its label as the goal).
const SUGGESTIONS: { icon: string; label: string }[] = [
  { icon: "ph-trend-up", label: "Grow it over a few years" },
  { icon: "ph-shield-check", label: "Play it safe, still earn" },
  { icon: "ph-sparkle", label: "Go big on AI" },
  { icon: "ph-scales", label: "Review my portfolio" },
  { icon: "ph-arrow-up-right", label: "Rebalance my portfolio" },
  { icon: "ph-chart-line-up", label: "What moved today?" },
  { icon: "ph-piggy-bank", label: "Put my cash to work" },
  { icon: "ph-repeat", label: "Invest on autopilot" },
  { icon: "ph-bell", label: "Set a price alert" },
  { icon: "ph-hand-tap", label: "Buy $25 of Apple" },
  { icon: "ph-coin", label: "Buy me some $MONVERA" },
  { icon: "ph-seal-check", label: "Show your track record" },
  { icon: "ph-hand-coins", label: "Sell everything" },
  { icon: "ph-list-checks", label: "What alerts do I have?" },
];

/** Pair the longest label with the shortest (2 per row) so a wide tile shares
 *  its row with a narrow one instead of hogging a full line on phones. */
function pairUp(items: typeof SUGGESTIONS): (typeof SUGGESTIONS)[] {
  const bySize = [...items].sort((a, b) => b.label.length - a.label.length);
  const rows: (typeof SUGGESTIONS)[] = [];
  let lo = 0, hi = bySize.length - 1;
  while (lo < hi) rows.push([bySize[lo++], bySize[hi--]]);
  if (lo === hi) rows.push([bySize[lo]]); // odd count: middle one rides alone
  return rows;
}

export function ChatCenter({ nav, chat, narrowed, pendingAsk, consumeAsk, mobile = false }: {
  nav: ChatNav;
  chat: ReturnType<typeof useVeraChat>;
  narrowed: boolean;
  pendingAsk: string | null;
  consumeAsk: () => void;
  /** Phone shell: edge-to-edge composer, short placeholder, no desktop footer,
   *  suggestions flow full-width so they sit side by side. */
  mobile?: boolean;
}) {
  const invest = useInvest();
  const avatar = useAvatar();
  const { setColorMode } = useTheme();
  const { setColorStyle } = useColorStyle();
  const { address } = useSmartAccount();
  const portfolioQ = usePortfolio(address ?? undefined);
  const portfolio = portfolioQ.data;

  const { phase, error: investError, success: investSuccess, busy: investBusy, allocate, invest: placeInvest, reset } = invest;
  const { activeId, messages, createThread, append } = chat;

  // Chat-native $MONVERA orders: Vera proposes, the user confirms inline, the
  // token swap rails execute (its own gasless route — never the Arcus flow).
  const tokenSwap = useMonveraSwap();
  const tokenDoneGuard = useRef(false);
  useEffect(() => {
    const threadId = activeId ?? threadRef.current;
    if (tokenSwap.phase === "done" && tokenSwap.result) {
      if (tokenDoneGuard.current) return;
      tokenDoneGuard.current = true;
      const r = tokenSwap.result;
      const receipt: TokenReceipt = r.side === "buy"
        ? { side: "buy", paid: usd(Number(formatUnits(r.amountIn, 6))), received: `${fmtTok(r.amountOut)} $MONVERA`, min: `${fmtTok(r.minOut)} $MONVERA`, txHash: r.txHash }
        : { side: "sell", paid: `${fmtTok(r.amountIn)} $MONVERA`, received: usd(Number(formatUnits(r.amountOut, 6))), min: usd(Number(formatUnits(r.minOut, 6))), txHash: r.txHash };
      if (threadId) append({ threadId, role: "vera", content: r.side === "buy" ? "Filled. Your $MONVERA is on its way to your wallet. The receipt:" : "Filled. The cash lands in your wallet. The receipt:", payload: { tokenReceipt: receipt } }).catch(() => {});
      tokenSwap.reset();
    } else if (tokenSwap.phase === "error" && tokenSwap.error) {
      if (tokenDoneGuard.current) return;
      tokenDoneGuard.current = true;
      if (threadId) append({ threadId, role: "vera", content: `That $MONVERA order didn't go through. Nothing left your wallet.\n${tokenSwap.error.slice(0, 160)}`, payload: { suggestions: ["Try again", "Buy $10 of MONVERA"] } }).catch(() => {});
      tokenSwap.reset();
    } else if (tokenSwap.phase === "idle") {
      tokenDoneGuard.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenSwap.phase]);

  const sellRawFor = (amountUsd: number): bigint | null => {
    const holding = (portfolio?.holdings ?? []).find((h) => h.asset.symbol === "MONVERA");
    if (!holding || holding.raw <= BigInt(0)) return null;
    const price = holding.priceUsd ?? (holding.qty > 0 ? (holding.valueUsd ?? 0) / holding.qty : 0);
    if (!price || price <= 0) return null;
    const qtyWanted = amountUsd / price;
    return qtyWanted >= holding.qty ? holding.raw : parseUnits(qtyWanted.toFixed(18), 18);
  };

  const confirmTokenOrder = (side: "buy" | "sell", amountUsd: number) => {
    if (tokenSwap.busy) return;
    if (side === "buy") { void tokenSwap.buy(amountUsd); return; }
    const raw = sellRawFor(amountUsd);
    if (raw !== null) { void tokenSwap.sell(raw); return; }
    // Never fall off the end silently: the holding or its live price hasn't
    // resolved yet — say so instead of doing nothing on a Confirm tap.
    const threadId = activeId ?? threadRef.current;
    if (threadId) {
      append({
        threadId, role: "vera",
        content: "Your live $MONVERA price hasn't loaded yet, so I can't size that sell. Give it a second and try again.",
        payload: { suggestions: ["Try again", "Open $MONVERA"] },
      }).catch(() => {});
    }
  };

  // Live preview on the confirm card: "$10 → ≈ 61,200 $MONVERA" from a real
  // quote, so the user sees what they're getting BEFORE they confirm.
  const [orderPreview, setOrderPreview] = useState<{ msgId: string; text: string } | null>(null);
  const lastMsg = chat.messages[chat.messages.length - 1];
  const lastOrder = (lastMsg?.payload as { tokenOrder?: { side: "buy" | "sell"; amountUsd: number } } | null)?.tokenOrder;
  useEffect(() => {
    if (!lastMsg || !lastOrder) return;
    if (orderPreview?.msgId === lastMsg.id) return;
    let stale = false;
    void (async () => {
      try {
        if (lastOrder.side === "buy") {
          const out = await tokenSwap.quoteOut("buy", parseUnits(lastOrder.amountUsd.toFixed(6), 6));
          if (!stale && out > BigInt(0)) setOrderPreview({ msgId: lastMsg.id, text: `${usd(lastOrder.amountUsd)} → ≈ ${fmtTok(out)} $MONVERA` });
        } else {
          const raw = sellRawFor(lastOrder.amountUsd);
          if (raw === null) return;
          const out = await tokenSwap.quoteOut("sell", raw);
          if (!stale && out > BigInt(0)) setOrderPreview({ msgId: lastMsg.id, text: `${fmtTok(raw)} $MONVERA → ≈ ${usd(Number(formatUnits(out, 6)))}` });
        }
      } catch { /* preview is best-effort; the card still works without it */ }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsg?.id, lastOrder?.side, lastOrder?.amountUsd]);

  // Fresh-success celebration flag — declared up here because both the invest
  // and the sell watchers below fire it.
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(false), 2800);
    return () => clearTimeout(t);
  }, [celebrate]);

  // Chat-native SELLS: Vera proposes legs, the user confirms inline, the same
  // battle-tested sell rails execute (one leg or the whole portfolio), the old
  // app's selling conveyor runs, and a receipt lands in the thread.
  const seller = useSellAll();
  const [sellAsk, setSellAsk] = useState<{ legs: { symbol: string; amountUsd: number; all: boolean }[]; totalUsd: number } | null>(null);
  const lastSellLegsRef = useRef<{ symbol: string; amountUsd: number; all: boolean }[]>([]);
  const confirmSellPlan = (legs: { symbol: string; amountUsd: number; all: boolean }[], mode: "auto" | "manual") => {
    lastSellLegsRef.current = legs;
    setSellAsk(null);
    if (seller.busy) return;
    const sels: SellSelection[] = [];
    for (const leg of legs) {
      const holding = (portfolio?.holdings ?? []).find((h) => h.asset.symbol === leg.symbol);
      const asset = assetBySymbol(leg.symbol);
      if (!holding || !asset || holding.raw <= BigInt(0)) continue;
      const price = holding.priceUsd ?? (holding.qty > 0 ? (holding.valueUsd ?? 0) / holding.qty : 0);
      let amountIn: bigint;
      if (leg.all || !price || price <= 0) amountIn = holding.raw;
      else {
        const qtyWanted = leg.amountUsd / price;
        amountIn = qtyWanted >= holding.qty ? holding.raw : parseUnits(qtyWanted.toFixed(18), 18);
      }
      if (amountIn > BigInt(0)) sels.push({ asset, amountIn, estUsd: leg.amountUsd });
    }
    haptic.medium();
    if (sels.length === 0) {
      const threadId = activeId ?? threadRef.current;
      if (threadId) append({ threadId, role: "vera", content: "I couldn't size that sell from your live holdings. Refresh and try again." }).catch(() => {});
      return;
    }
    void seller.sellAll(sels, mode);
  };
  const sellDoneGuard = useRef(false);
  useEffect(() => {
    const threadId = activeId ?? threadRef.current;
    if (seller.phase === "done" && seller.success) {
      if (sellDoneGuard.current) return;
      sellDoneGuard.current = true;
      haptic.success();
      setCelebrate(true);
      if (threadId) append({
        threadId, role: "vera", kind: "sellReceipt",
        content: seller.success.anySettling
          ? "Sold. Most of it is cash already; the rest is settling and lands in minutes. Your receipt:"
          : "Sold. The cash is in your wallet. Your receipt:",
        payload: seller.success,
      }).catch(() => {});
      seller.reset();
    } else if (seller.phase === "error" && seller.error) {
      if (sellDoneGuard.current) return;
      sellDoneGuard.current = true;
      if (threadId) append({ threadId, role: "vera", content: `That sell didn't go through — your holdings are untouched.
${seller.error.slice(0, 160)}`, payload: { suggestions: ["Try again"] } }).catch(() => {});
      seller.reset();
    } else if (seller.phase === "idle") {
      sellDoneGuard.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seller.phase]);

  const [draft, setDraft] = useState("");
  const [allocating, setAllocating] = useState(false);
  const [thinkStep, setThinkStep] = useState(0);

  const busy = allocating || investBusy;
  const placing = phase === "planning" || phase === "approving" || phase === "investing";
  const showThinking = allocating || placing;
  const idleish = phase === "idle" || phase === "error";
  const canInvest = !!address && (portfolio?.cashUsd ?? 0) >= 1;
  const maxW = narrowed ? 640 : 760;

  // Refs so async flows and effects never act on a stale render.
  const busyRef = useRef(false);
  busyRef.current = busy;
  const threadRef = useRef<string | null>(null);
  const lastGoalRef = useRef("");
  const lastAmountRef = useRef(0);
  const thinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);

  const post = (m: Parameters<typeof append>[0]) => { append(m).catch(() => {}); };

  const [thinkBeats, setThinkBeats] = useState<string[]>(THINK);
  const startThinking = (text?: string) => {
    const beats = text ? thinkTrackFor(text) : THINK;
    setThinkBeats(beats);
    setThinkStep(0);
    setAllocating(true);
    if (thinkTimer.current) clearInterval(thinkTimer.current);
    thinkTimer.current = setInterval(() => setThinkStep((s) => Math.min(s + 1, beats.length - 1)), THINK_STEP_MS);
  };
  const stopThinking = () => {
    setAllocating(false);
    if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null; }
  };
  useEffect(() => () => { if (thinkTimer.current) clearInterval(thinkTimer.current); }, []);

  /** Goal in → user msg + THINK beat + plan card out. The whole flow appends to ONE thread id. */
  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    startThinking(text);
    try {
      let threadId = activeId;
      if (!threadId) threadId = (await createThread(text.slice(0, 60))).id;
      threadRef.current = threadId;
      lastGoalRef.current = text;
      post({ threadId, role: "user", content: text });

      // One turn of Vera's brain: /api/vera classifies the message and either
      // answers, builds a plan, runs a review, or hands off to a ticket/panel.
      const recent = messages.slice(-12).map((m) => {
        // Compress cards into content the model can actually use next turn
        // ("what did you suggest earlier?" must be answerable from history).
        let what: string;
        if (m.kind === "plan" && m.payload) {
          const p = m.payload as AllocateResult;
          const legs = (p.allocations ?? []).map((a) => `${Math.round(a.weightPct)}% ${a.symbol}`).join(", ");
          what = `[proposed: ${legs} for $${p.amountUsd}]`;
        } else if (m.kind === "success" && m.payload) {
          const sc = m.payload as InvestSuccess;
          what = `[invested $${sc.amountUsd} across ${(sc.holdings ?? []).length} holdings]`;
        } else if (m.kind === "sellReceipt" && m.payload) {
          const sr = m.payload as SellSuccess;
          what = `[sold ${(sr.sold ?? []).length} holdings for $${sr.totalUsd.toFixed(2)}]`;
        } else {
          what = m.content;
        }
        return `${m.role === "user" ? "user" : "vera"}: ${String(what).slice(0, 260)}`;
      });
      const res = await fetch("/api/vera", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          text,
          cashUsd: portfolio?.cashUsd,
          investedUsd: portfolio?.investedUsd,
          holdings: (portfolio?.holdings ?? []).slice(0, 50).map((h) => ({
            symbol: h.asset.symbol, qty: h.qty, valueUsd: h.valueUsd, dayChangePct: h.dayChangePct, settlingUsd: h.settlingUsd,
          })),
          recent,
          address: address ?? undefined,
        }),
      });
      if (res.status === 429) {
        stopThinking();
        const threadId2 = activeId ?? threadRef.current;
        if (threadId2) post({ threadId: threadId2, role: "vera", content: "I'm getting messages faster than I can think. Give me a few seconds and send that again." });
        return;
      }
      if (!res.ok) throw new Error(`vera ${res.status}`);
      const turn = (await res.json()) as
        | { intent: "reply"; message: string; suggestions?: string[] }
        | { intent: "plan"; message: string; payload: AllocateResult }
        | { intent: "open"; target: string; symbol?: string; message: string }
        | { intent: "review"; message: string; payload: Record<string, unknown> }
        | { intent: "sell_plan"; message: string; legs: { symbol: string; amountUsd: number; all: boolean }[]; totalUsd: number }
        | { intent: "preference"; setting: "theme" | "palette"; value: string; message: string }
        | { intent: "order"; symbol: string; side: "buy" | "sell"; amountUsd?: number; message: string }
        | { intent: "token_order"; side: "buy" | "sell"; amountUsd: number; message: string }
        | { intent: "autopilot"; amountUsd: number; cadence: "daily" | "weekly" | "biweekly" | "monthly"; risk: "careful" | "balanced" | "bolder"; message: string }
        | { intent: "grove_list"; message: string; groves: GroveListItem[] };
      stopThinking();

      if (turn.intent === "plan") {
        const amt = turn.payload.amountUsd;
        lastAmountRef.current = amt;
        post({
          threadId, role: "vera", kind: "plan",
          content: turn.message || `Here's what I'd do with ${usd0(amt)} — ${turn.payload.summary.toLowerCase().replace(/\.$/, "")}. Have a look, then invest or nudge it.`,
          payload: turn.payload,
        });
      } else if (turn.intent === "preference") {
        // Vera applies the visual preference herself and says so.
        if (turn.setting === "theme") setColorMode(turn.value as "light" | "dark");
        else setColorStyle(turn.value);
        post({ threadId, role: "vera", content: turn.message });
      } else if (turn.intent === "sell_plan") {
        post({ threadId, role: "vera", content: turn.message, payload: { sellPlan: { legs: turn.legs, totalUsd: turn.totalUsd } } });
      } else if (turn.intent === "review") {
        post({ threadId, role: "vera", kind: "review", content: turn.message, payload: turn.payload });
      } else if (turn.intent === "open") {
        // Persist the target so the message keeps a working "open again" chip
        // after the panel is closed — no need to ask twice.
        post({ threadId, role: "vera", content: turn.message, payload: { open: { target: turn.target, symbol: turn.symbol } } });
        openTarget(turn.target, turn.symbol);
      } else if (turn.intent === "order") {
        post({ threadId, role: "vera", content: turn.message });
        if (turn.amountUsd) setOrderAmountPrefill(turn.amountUsd);
        if (turn.side === "buy") nav.openBuy(turn.symbol); else nav.openSell(turn.symbol);
      } else if (turn.intent === "token_order") {
        post({ threadId, role: "vera", content: turn.message, payload: { tokenOrder: { side: turn.side, amountUsd: turn.amountUsd } } });
      } else if (turn.intent === "grove_list") {
        // The shelf persists in the thread — each card asks for that Grove's
        // composition; a grove_buy comes back as a normal plan card.
        post({ threadId, role: "vera", content: turn.message, payload: { groveList: turn.groves } });
      } else if (turn.intent === "autopilot") {
        // Vera collected amount/cadence/risk in chat — hand them to the canvas
        // prefilled; the user reviews and hits Start (authorization stays theirs).
        post({ threadId, role: "vera", content: turn.message });
        setAutopilotPrefill({ amountUsd: turn.amountUsd, cadence: turn.cadence, risk: turn.risk });
        nav.openCanvas("autopilot");
      } else {
        // Quick replies ride in the payload — chips render under the message.
        post({ threadId, role: "vera", content: turn.message, payload: turn.suggestions?.length ? { suggestions: turn.suggestions } : undefined });
      }
    } catch (e) {
      stopThinking();
      const threadId = activeId ?? threadRef.current;
      if (threadId) post({ threadId, role: "vera", content: "Something went wrong on my side just now. Give it another try in a moment." });
      console.error("[chat] submit failed:", e instanceof Error ? e.message : e);
    }
  };

  /** Nudge a live plan: same goal + tone hint, same amount, mapped risk tolerance. */
  const nudge = async (tone: NudgeTone, plan: AllocateResult) => {
    if (busyRef.current) return;
    const threadId = activeId ?? threadRef.current;
    if (!threadId) return;
    busyRef.current = true;
    startThinking();
    post({ threadId, role: "user", content: `Make it ${tone}` });
    const goal = (lastGoalRef.current || plan.summary || "Put my cash to work") + NUDGE_HINT[tone];
    const amt = Math.max(1, Math.round(plan.amountUsd || lastAmountRef.current || 100));
    lastAmountRef.current = amt;
    const result = await allocate(goal, amt, NUDGE_RISK[tone]);
    stopThinking();
    if (result) {
      post({ threadId, role: "vera", kind: "plan", content: `Done — ${result.summary.toLowerCase()}`, payload: result });
    }
  };

  const [placingPlan, setPlacingPlan] = useState<AllocateResult | null>(null);
  // Which Grove the in-flight invest came from (if any) — read when the success
  // card lands so the receipt links back to /groves/<id>. A ref, not state:
  // placingPlan is cleared on the same phase change the success watcher fires on.
  const lastGroveRef = useRef<{ id: string; name: string } | null>(null);
  // "How should we place it?" — the old app's choice: Vera signs silently
  // (auto) or the user approves every signature (manual).
  const [modeAsk, setModeAsk] = useState<AllocateResult | null>(null);
  const doInvest = (plan: AllocateResult, mode: "auto" | "manual" = "auto") => {
    if (busyRef.current || !address || !canInvest) return;
    haptic.medium();
    setModeAsk(null);
    lastGroveRef.current = (plan as GrovePlan).grove ?? null;
    setPlacingPlan(plan);
    threadRef.current = activeId ?? threadRef.current;
    void placeInvest(plan, plan.amountUsd, address, mode);
  };
  // The conveyor overlay lives only while the invest is actually running.
  useEffect(() => {
    if (phase === "idle" || phase === "done" || phase === "error") setPlacingPlan(null);
  }, [phase]);

  // One opener for everything Vera can open — sheets are not canvases, so the
  // enum cast alone would silently no-op on send/receive/settings.
  const openTarget = (target: string, symbol?: string) => {
    if (target === "send") nav.openSend();
    else if (target === "receive") nav.openReceive();
    else if (target === "settings") nav.openSettings();
    else if (target === "groves") nav.openGroves(symbol);
    else nav.openCanvas(target as Parameters<typeof nav.openCanvas>[0], symbol);
  };

  // Scan → chat: an adopted basket arrives structured (weights intact). Vera
  // shows what's behind the product and asks the amount; each chip builds the
  // EXACT plan deterministically — no second LLM pass, nothing re-invented.
  const adoptGuard = useRef(false);
  useEffect(() => {
    if (adoptGuard.current) return;
    const adopted = consumeAdoptedPlan();
    if (!adopted) return;
    adoptGuard.current = true;
    void (async () => {
      let threadId = activeId;
      if (!threadId) {
        const t = await createThread(`Scan: ${adopted.brand}`).catch(() => null);
        if (!t) return;
        threadId = t.id;
        threadRef.current = threadId;
      }
      const cash = Math.floor(portfolio?.cashUsd ?? 0);
      const sizes = [25, 50, 100].filter((v) => v <= cash);
      post({
        threadId, role: "vera",
        content: `Here's what's behind ${adopted.brand}: ${adopted.connections.map((c) => `${c.symbol} ${c.weightPct}%`).join(" · ")}. How much should I put in? These exact weights get bought, nothing substituted.`,
        payload: { adoptedPlan: adopted, suggestions: [...sizes.map((v) => `$${v}`), cash >= 1 ? `All $${cash}` : ""].filter(Boolean).slice(0, 4) },
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the adopted plan card for a chosen amount — pure client, exact weights.
  const buildAdoptedPlan = (adopted: { brand: string; connections: { symbol: string; weightPct: number; reason: string }[] }, amountUsd: number) => {
    const threadId = activeId ?? threadRef.current;
    if (!threadId) return;
    post({ threadId, role: "user", content: `Invest $${amountUsd} in the ${adopted.brand} basket` });
    const total = adopted.connections.reduce((n, c) => n + c.weightPct, 0) || 100;
    const allocations = adopted.connections.map((c) => ({
      symbol: c.symbol,
      weightPct: Math.round((c.weightPct / total) * 10000) / 100,
      reason: c.reason.slice(0, 200),
    }));
    const payload: AllocateResult = {
      summary: `The companies behind ${adopted.brand}`,
      rationale: `Built straight from your scan of ${adopted.brand}: each company is there because of its real connection to the product, weighted by how central it is. Exact weights, nothing substituted.`,
      riskScore: 6500,
      allocations,
      backtest: null,
      amountUsd,
      model: "scan",
    };
    lastAmountRef.current = amountUsd;
    post({ threadId, role: "vera", kind: "plan", content: `Here's the ${adopted.brand} basket as a plan: $${amountUsd}, split by connection strength. Look it over, then invest or nudge it.`, payload });
  };

  // pendingAsk (nav.askVera) → consume + submit exactly once.
  const askGuard = useRef(false);
  useEffect(() => {
    if (!pendingAsk) { askGuard.current = false; return; }
    if (askGuard.current) return;
    askGuard.current = true;
    consumeAsk();
    void submit(pendingAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk]);

  // Invest done → append the success card, then reset the invest state.
  const successGuard = useRef(false);
  useEffect(() => {
    if (phase !== "done" || !investSuccess) { successGuard.current = false; return; }
    if (successGuard.current) return;
    successGuard.current = true;
    haptic.success();
    setCelebrate(true);
    const threadId = activeId ?? threadRef.current;
    const grove = lastGroveRef.current;
    lastGroveRef.current = null;
    if (threadId) append({
      threadId, role: "vera", kind: "success",
      // Grove buys get a line + an open chip back to the IN-APP Grove page.
      content: grove ? `That's the ${grove.name} in your wallet, at its published weights.` : "",
      payload: grove ? { ...investSuccess, open: { target: "groves", symbol: grove.id } } : investSuccess,
    }).catch(() => {});
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, investSuccess]);

  // Any allocate/invest error → one friendly Vera message (the hook's errors are already plain-language).
  const errorGuard = useRef(false);
  useEffect(() => {
    if (phase !== "error" || !investError) { errorGuard.current = false; return; }
    if (errorGuard.current) return;
    errorGuard.current = true;
    const threadId = activeId ?? threadRef.current;
    if (threadId) append({ threadId, role: "vera", content: investError }).catch(() => {});
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, investError]);

  const msgs = activeId ? messages : [];

  // Keep the conversation pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, activeId, showThinking]);

  const sendDisabled = !draft.trim() || busy;
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void submit(text);
  };

  return (
    <>
      {/* Placing conveyor — the old app's "securing your investment" stage, as a
          full-screen overlay: everything behind blurs, each stock flies through
          the spotlight as its own gasless buy, queue rail + live progress below. */}
      {/* fresh-success celebration — the old app's confetti, once, never on reload */}
      {celebrate && (
        <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 135, pointerEvents: "none", ["--ease" as string]: "cubic-bezier(.22,1,.36,1)", ["--accent" as string]: "color-mix(in srgb, var(--primary) 55%, #fff)" } as React.CSSProperties}>
          <Confetti />
        </div>
      )}
      {/* "How should we place it?" — auto (Vera signs) vs manual (approve each) */}
      {modeAsk && !placing && (
        <ModeChooser
          plan={modeAsk}
          onChoose={(m) => doInvest(modeAsk, m)}
          onClose={() => setModeAsk(null)}
        />
      )}
      {/* selling conveyor — chat-native, no old-app palette bleed */}
      {seller.busy && seller.progress && (
        <ConveyorOverlay
          mode="sell"
          current={seller.progress.currentSymbol}
          legs={(sellAsk?.legs ?? lastSellLegsRef.current).map((l) => ({ symbol: l.symbol, usd: l.amountUsd }))}
          filled={seller.progress.filledSymbols}
          done={seller.progress.done}
          total={seller.progress.total}
          movedUsd={seller.progress.proceedsUsd}
          totalUsd={seller.progress.totalUsd}
          etaSeconds={seller.progress.etaSeconds}
          manual={seller.progress.mode === "manual"}
        />
      )}
      {/* sell sign-mode chooser (auto vs approve-each), mirrors the invest one */}
      {sellAsk && !seller.busy && (
        <SellModeChooser
          totalUsd={sellAsk.totalUsd}
          count={sellAsk.legs.length}
          onChoose={(m) => confirmSellPlan(sellAsk.legs, m)}
          onClose={() => setSellAsk(null)}
        />
      )}
      {placing && placingPlan && (
        <ConveyorOverlay
          mode="buy"
          current={invest.progress?.currentSymbol ?? null}
          legs={(placingPlan.allocations ?? []).map((a) => ({ symbol: a.symbol, usd: (placingPlan.amountUsd * a.weightPct) / 100 }))}
          filled={invest.progress?.filledSymbols ?? []}
          done={invest.progress?.done ?? 0}
          total={invest.progress?.total ?? (placingPlan.allocations ?? []).length}
          movedUsd={invest.progress?.spentUsd ?? 0}
          totalUsd={invest.progress?.totalUsd ?? placingPlan.amountUsd}
          etaSeconds={invest.progress?.etaSeconds ?? null}
          manual={invest.progress?.mode === "manual"}
        />
      )}
      <main ref={scrollRef} className="scr" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: maxW, width: "100%", margin: "0 auto", padding: mobile ? "20px 16px 8px" : "28px 22px 16px", display: "flex", flexDirection: "column", gap: mobile ? 18 : 20 }}>
          {/* Greeting — local (unpersisted) until the first goal creates a thread. */}
          {!activeId && (
            <VeraRow>
              <div style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--ink)" }}>{GREET}</div>
              <PortfolioCard data={portfolio} nav={nav} />
            </VeraRow>
          )}

          {msgs.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={m.id} style={{ alignSelf: "flex-end", display: "flex", alignItems: "flex-end", gap: 9, maxWidth: "84%" }}>
                  <div className="msg" style={{ background: "var(--primary)", color: "var(--primary-ink)", padding: "12px 16px", borderRadius: "20px 20px 6px 20px", fontSize: 15, lineHeight: 1.5, fontWeight: 500, whiteSpace: "pre-wrap" }}>{m.content}</div>
                  {avatar.kind === "upload" && avatar.value ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar.value} alt="" width={30} height={30} style={{ borderRadius: "50%", flex: "none", objectFit: "cover", boxShadow: "0 1px 6px rgba(0,0,0,.18)" }} />
                  ) : (
                    <span aria-hidden style={{ width: 30, height: 30, borderRadius: "50%", flex: "none", background: avatarCss(avatar), boxShadow: "inset 0 1px 2px rgba(255,255,255,.4), 0 1px 6px rgba(0,0,0,.18)" }} />
                  )}
                </div>
              );
            }
            const plan = m.kind === "plan" && m.payload && Array.isArray((m.payload as AllocateResult).allocations) ? (m.payload as AllocateResult) : null;
            const success = m.kind === "success" && m.payload ? (m.payload as InvestSuccess) : null;
            const review = m.kind === "review" && m.payload ? (m.payload as ReviewPayload) : null;
            const live = !!plan && i === msgs.length - 1 && idleish && !busy;
            return (
              <VeraRow key={m.id}>
                {m.content ? <div style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--ink)", whiteSpace: "pre-wrap" }}><VeraRich text={m.content} /></div> : null}
                {/* chat-native $MONVERA order — confirm executes via the token swap rails */}
                {(() => {
                  const to = (m.payload as { tokenOrder?: { side: "buy" | "sell"; amountUsd: number } } | null)?.tokenOrder;
                  if (!to || i !== msgs.length - 1) return null;
                  return (
                    <div style={{ marginTop: 12, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, maxWidth: 420 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{to.side === "buy" ? "Buy" : "Sell"} ${to.amountUsd} of $MONVERA</div>
                        {orderPreview?.msgId === m.id ? (
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                            <PIcon name="ph-lightning" size={13} weight="fill" /> {orderPreview.text}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                            <PIcon name="ph-circle-notch" size={12} weight="bold" style={{ animation: "mvcspin .9s linear infinite" }} /> Fetching live quote…
                          </div>
                        )}
                        <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 3 }}>Self-custody · gas on us · you sign, nothing moves without you</div>
                      </div>
                      <button
                        onClick={() => confirmTokenOrder(to.side, to.amountUsd)}
                        disabled={tokenSwap.busy}
                        style={{ height: 42, padding: "0 18px", flex: "none", borderRadius: 13, fontSize: 13.5, fontWeight: 700, background: to.side === "buy" ? "var(--primary)" : "var(--neg)", color: "#fff", opacity: tokenSwap.busy ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 7 }}
                      >
                        {tokenSwap.busy ? <><PIcon name="ph-circle-notch" size={15} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} /> Placing…</> : "Confirm"}
                      </button>
                    </div>
                  );
                })()}
                {/* $MONVERA fill receipt — persisted, renders on every reload */}
                {(() => {
                  const rc = (m.payload as { tokenReceipt?: TokenReceipt } | null)?.tokenReceipt;
                  if (!rc) return null;
                  const rows: [string, string][] = [
                    [rc.side === "buy" ? "You paid" : "You sold", rc.paid],
                    ["You received", `≈ ${rc.received}`],
                    ["Guaranteed minimum", rc.min],
                  ];
                  return (
                    <div style={{ marginTop: 12, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden", maxWidth: 420 }}>
                      <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: 999, flex: "none", display: "grid", placeItems: "center", background: "color-mix(in oklab, var(--primary) 18%, transparent)", color: "var(--primary)" }}>
                          <PIcon name="ph-check-circle" size={18} weight="fill" />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{rc.side === "buy" ? "Bought $MONVERA" : "Sold $MONVERA"}</div>
                          <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Gas on us · settled on-chain</div>
                        </div>
                      </div>
                      <div style={{ padding: "11px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
                        {rows.map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontSize: 13 }}>
                            <span style={{ color: "var(--ink-2)" }}>{k}</span>
                            <span style={{ fontWeight: 650, textAlign: "right" }}>{v}</span>
                          </div>
                        ))}
                        <a href={`${EXPLORER_TX}${rc.txHash}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12.5, fontWeight: 600, color: "var(--primary)" }}>
                          <PIcon name="ph-arrow-square-out" size={13} weight="bold" /> {rc.txHash.slice(0, 10)}…{rc.txHash.slice(-6)} on Blockscout
                        </a>
                      </div>
                    </div>
                  );
                })()}
                {/* re-open chip — panels close; the door in the thread stays */}
                {(() => {
                  const op = (m.payload as { open?: { target: string; symbol?: string } } | null)?.open;
                  if (!op) return null;
                  const label = op.target === "groves" ? "the Grove" : (OPEN_LABELS[op.symbol ? `holding` : op.target] ?? op.target);
                  return (
                    <button
                      onClick={() => openTarget(op.target, op.symbol)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "9px 14px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12.5, fontWeight: 650, color: "var(--ink)" }}
                    >
                      <PIcon name="ph-arrow-square-out" size={14} weight="bold" style={{ color: "var(--primary)" }} />
                      Open {op.symbol ? displayFor(op.symbol).name || op.symbol : label}
                    </button>
                  );
                })()}
                {/* adopted-basket amount chips — build the exact plan, no LLM pass */}
                {(() => {
                  const ap = (m.payload as { adoptedPlan?: { brand: string; connections: { symbol: string; weightPct: number; reason: string }[] } } | null)?.adoptedPlan;
                  const sugg = (m.payload as { suggestions?: string[] } | null)?.suggestions;
                  if (!ap || !Array.isArray(sugg) || sugg.length === 0 || i !== msgs.length - 1) return null;
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                      {sugg.map((sg) => {
                        const amt = parseInt(String(sg).replace(/[^0-9]/g, ""), 10);
                        if (!amt) return null;
                        return (
                          <button key={sg} disabled={busy} onClick={() => buildAdoptedPlan(ap, amt)} style={{ padding: "8px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", whiteSpace: "nowrap", opacity: busy ? 0.5 : 1 }}>{String(sg)}</button>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* quick replies — tap to prefill the composer (editable, then send) */}
                {(() => {
                  if ((m.payload as { adoptedPlan?: unknown } | null)?.adoptedPlan) return null;
                  const sugg = (m.payload as { suggestions?: string[] } | null)?.suggestions;
                  if (!Array.isArray(sugg) || sugg.length === 0) return null;
                  // Persisted chips stay useful on OLD messages too — dimmed
                  // while Vera is busy rather than vanishing.
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                      {sugg.slice(0, 4).map((sg) => (
                        <button key={sg} disabled={busy} onClick={() => setDraft(String(sg))} style={{ padding: "8px 13px", border: "1px solid var(--line)", borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: "var(--panel)", color: "var(--ink-2)", whiteSpace: "nowrap", opacity: busy ? 0.5 : 1 }}>{String(sg)}</button>
                      ))}
                    </div>
                  );
                })()}
                {/* the Grove shelf — compact cards; tap one to open its in-app page */}
                {(() => {
                  const gl = (m.payload as { groveList?: GroveListItem[] } | null)?.groveList;
                  if (!Array.isArray(gl) || gl.length === 0) return null;
                  return (
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 440 }}>
                      {gl.map((g) => (
                        <button key={g.id} disabled={busy} onClick={() => nav.openGroves(g.id)} style={{ textAlign: "left", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: "12px 14px", opacity: busy ? 0.6 : 1 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{g.name}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 650, color: "var(--primary)" }}>{g.ticker}</span>
                            <span className="tnum" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 650, color: "var(--ink-2)", whiteSpace: "nowrap" }}>min {usd0(g.minBuyUsd)}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 3 }}>{g.thesis}</div>
                          {typeof g.returnPct === "number" && (
                            <div className="tnum" style={{ fontSize: 12, fontWeight: 650, marginTop: 4, color: dcol(g.returnPct) }}>
                              {pctStr(g.returnPct)} past year{typeof g.spyPct === "number" ? <span style={{ color: "var(--ink-3)", fontWeight: 550 }}> · S&P 500 {pctStr(g.spyPct)}</span> : null}
                            </div>
                          )}
                        </button>
                      ))}
                      <div style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "center" }}>Tap a Grove to open it · only fee: 10% of profit when you exit · backtests are history, not promises</div>
                    </div>
                  );
                })()}
                {m.kind === "portfolio" && <PortfolioCard data={portfolio} nav={nav} />}
                {plan && <PlanCard plan={plan} live={live} canInvest={canInvest} onInvest={() => setModeAsk(plan)} onNudge={(t) => void nudge(t, plan)} nav={nav} />}
                {success && <SuccessCard s={success} nav={nav} />}
                {review && <ReviewCard review={review} onAsk={(t) => void submit(t)} nav={nav} />}
                {(() => {
                  const sp = (m.payload as { sellPlan?: { legs: { symbol: string; amountUsd: number; all: boolean }[]; totalUsd: number } } | null)?.sellPlan;
                  if (!sp || i !== msgs.length - 1) return null;
                  return (
                    <div style={{ marginTop: 12, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, padding: "14px 16px", maxWidth: 440 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--neg)", marginBottom: 8 }}>
                        Sell · ≈ {usd(sp.totalUsd)} back to cash
                      </div>
                      {sp.legs.map((leg) => (
                        <div key={leg.symbol} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line-2)" }}>
                          <AssetTile asset={toTile(leg.symbol)} size={30} radius={9} />
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5 }}>{displayFor(leg.symbol).name}</span>
                          <span className="tnum" style={{ fontSize: 13, fontWeight: 650 }}>{leg.all ? "entire position" : usd(leg.amountUsd)}</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <button
                          onClick={() => setSellAsk(sp)}
                          disabled={seller.busy}
                          style={{ flex: 1, height: 44, borderRadius: 13, fontSize: 13.5, fontWeight: 700, background: "var(--neg)", color: "#fff", opacity: seller.busy ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
                        >
                          {seller.busy ? <><PIcon name="ph-circle-notch" size={15} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} /> Selling…</> : `Sell ${sp.legs.length === 1 ? sp.legs[0].symbol : `${sp.legs.length} holdings`}`}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8, textAlign: "center" }}>Live quotes at fill · gas on us · nothing moves until you confirm</div>
                    </div>
                  );
                })()}
                {(() => {
                  const sr = m.kind === "sellReceipt" && m.payload ? (m.payload as SellSuccess) : null;
                  if (!sr) return null;
                  return (
                    <div style={{ marginTop: 12, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden", maxWidth: 440 }}>
                      <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: 999, flex: "none", display: "grid", placeItems: "center", background: "color-mix(in oklab, var(--primary) 18%, transparent)", color: "var(--primary)" }}>
                          <PIcon name="ph-check-circle" size={18} weight="fill" />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>Sold. {usd(sr.totalUsd)} to cash</div>
                          <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{sr.sold.length} holding{sr.sold.length === 1 ? "" : "s"} · gasless{sr.anySettling ? " · some proceeds settling" : ""}</div>
                        </div>
                      </div>
                      <div style={{ padding: "6px 16px 12px" }}>
                        {sr.sold.map((h) => (
                          <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
                            <AssetTile asset={toTile(h.symbol, h.name)} size={28} radius={9} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: "block", fontWeight: 600, fontSize: 12.5 }}>{h.name}</span>
                              {h.txHash ? (
                                <a href={`${EXPLORER_TX}${h.txHash}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 10.5, color: "var(--primary)", fontWeight: 600 }}>
                                  {h.txHash.slice(0, 10)}…{h.txHash.slice(-4)} ↗
                                </a>
                              ) : (
                                <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{h.settling ? "settling, lands in minutes" : "receipt pending"}</span>
                              )}
                            </span>
                            <span className="tnum" style={{ fontSize: 12.5, fontWeight: 650 }}>{usd(h.amountUsd)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </VeraRow>
            );
          })}

          {/* Thinking bubble — allocating cycles THINK; placing shows the invest beat. */}
          {showThinking && (
            <VeraRow>
              <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 15px", border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", fontSize: 14, color: "var(--ink-2)" }}>
                <PIcon name="ph-circle-notch" size={15} weight="bold" style={{ color: "var(--primary)", animation: "mvcspin .9s linear infinite" }} />
                {placing ? "Placing your plan…" : thinkBeats[Math.min(thinkStep, thinkBeats.length - 1)]}
              </div>
            </VeraRow>
          )}

          {!activeId && !busy && (() => {
            // Aligned under the portfolio card (paddingLeft = orb 30 + gap 13).
            // Mobile packs exactly two per row, pairing the longest label with the
            // shortest so a big tile shares its row with a small one; both grow to
            // fill the row. Desktop keeps the free-flowing pill wrap — no wrappers.
            const chip = (s: (typeof SUGGESTIONS)[number]) => (
              <button
                key={s.label}
                onClick={() => void submit(s.label)}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: mobile ? "flex-start" : "center", gap: 8, padding: mobile ? "10px 12px" : "10px 15px", border: "1px solid var(--line)", borderRadius: mobile ? 14 : 999, fontSize: mobile ? 12.5 : 13.5, fontWeight: 500, background: "var(--panel)", color: "var(--ink-2)", whiteSpace: "nowrap", ...(mobile ? { flex: "1 1 auto", minWidth: 0 } : {}) }}
              >
                <PIcon name={s.icon} size={16} style={{ color: "var(--primary)", flex: "none" }} />
                <span style={mobile ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } : undefined}>{s.label}</span>
              </button>
            );
            return mobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 43 }}>
                {pairUp(SUGGESTIONS).map((row, ri) => (
                  <div key={ri} style={{ display: "flex", gap: 8 }}>{row.map(chip)}</div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 9, paddingLeft: 43 }}>{SUGGESTIONS.map(chip)}</div>
            );
          })()}
          {/* the plain-language FAQ, back in the app: quieter chips that ask Vera */}
          {!activeId && (
            <div style={{ paddingLeft: mobile ? 0 : 43, marginTop: 2 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 7 }}>Common questions</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {FAQ.slice(0, 6).map((f) => (
                  <button key={f.q} onClick={() => void submit(f.q)} style={{ padding: "7px 12px", borderRadius: 999, border: "1px dashed var(--line)", fontSize: 12, fontWeight: 550, background: "transparent", color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                    {f.q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Composer — no flat fade; the glass pill sits straight on the aurora */}
      <div style={{ flex: "none", padding: mobile ? "10px 14px 14px" : "12px 22px 18px" }}>
        <div style={{ background: "var(--panel)", maxWidth: maxW, margin: "0 auto", display: "flex", alignItems: "flex-end", gap: mobile ? 9 : 10, border: "1.5px solid var(--line)", borderRadius: mobile ? 22 : 24, padding: mobile ? "7px 7px 7px 16px" : "8px 8px 8px 18px", boxShadow: "0 12px 36px rgba(12,32,20,.12)" }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder={mobile ? "Ask Vera anything…" : "Ask Vera to invest, or anything about your money…"}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontFamily: "inherit", fontSize: 15, lineHeight: 1.5, resize: "none", padding: "9px 0", maxHeight: mobile ? 110 : 120, minWidth: 0 }}
          />
          <button onClick={send} disabled={sendDisabled} aria-label="Send" style={{ width: mobile ? 42 : 44, height: mobile ? 42 : 44, flex: "none", borderRadius: mobile ? 14 : 15, display: "grid", placeItems: "center", background: "var(--primary)", color: "var(--primary-ink)", opacity: sendDisabled ? 0.5 : 1, cursor: sendDisabled ? "default" : "pointer" }}>
            <PIcon name="ph-arrow-up" size={mobile ? 18 : 19} weight="fill" />
          </button>
        </div>
        {!mobile && <div style={{ maxWidth: maxW, margin: "9px auto 0", textAlign: "center", fontSize: 11.5, color: "var(--ink-3)" }}>Vera builds diversified plans of real, tokenized stocks & ETFs — signed on-chain, placed gaslessly.</div>}
      </div>
    </>
  );
}

// ── message chrome ──────────────────────────────────────────────────────────

function VeraRow({ children }: { children: ReactNode }) {
  return (
    <div className="msg" style={{ display: "flex", gap: 13, alignSelf: "flex-start", maxWidth: "100%", width: "100%" }}>
      <ChatOrb size={30} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── portfolio card (greeting) — real balances, design's mini chart ──────────

function PortfolioCard({ data, nav }: { data?: Portfolio; nav: ChatNav }) {
  const holdings = (data?.holdings ?? [])
    .slice()
    .sort((a, b) => ((b.valueUsd ?? b.settlingUsd ?? 0) - (a.valueUsd ?? a.settlingUsd ?? 0)));
  const invested = data?.investedUsd ?? 0;
  const total = data?.totalUsd ?? 0;
  const dayUsd = (data?.holdings ?? []).reduce((s, h) => s + ((h.valueUsd ?? 0) * (h.dayChangePct ?? 0)) / 100, 0);
  // Real intraday value of the holdings — never a synthetic wave under money.
  const day = portfolioDayCurve(data?.holdings ?? [], data?.cashUsd ?? 0);
  const mini = day ? chartPaths(day.curve, 200, 64, { minSpanFrac: 0.02 }) : null;
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, marginTop: 14, overflow: "hidden" }}>
      <button onClick={() => nav.openCanvas("portfolio")} style={{ width: "100%", textAlign: "left", padding: "18px 20px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, borderBottom: "1px solid var(--line)" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)" }}>Total balance</div>
          <div className="serif tnum" style={{ fontSize: 34, fontWeight: 500, marginTop: 2, color: "var(--ink)" }}>{usd(total)}</div>
          <div className="tnum" style={{ fontSize: 13.5, fontWeight: 600, color: dcol(dayUsd), marginTop: 2 }}>{(dayUsd >= 0 ? "+" : "−") + "$" + Math.abs(dayUsd).toFixed(2)} today</div>
        </div>
        {mini ? (
          <svg viewBox="0 0 200 64" preserveAspectRatio="none" width={180} height={64} style={{ display: "block", flex: "none", maxWidth: "46%" }}>
            <defs>
              <linearGradient id="mvcg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={mini.area} fill="url(#mvcg)" />
            <path d={mini.line} fill="none" stroke="var(--primary)" strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
      <div style={{ padding: "8px 10px" }}>
        {holdings.map((h) => {
          const sym = h.asset.symbol;
          const value = h.valueUsd ?? h.settlingUsd ?? 0;
          const day = h.dayChangePct ?? 0;
          return (
            <button key={sym} className="hgl" onClick={() => nav.openCanvas("holding", sym)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 13 }}>
              <AssetTile asset={toTile(sym, h.asset.name)} size={34} radius={10} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{displayFor(sym, h.asset.name).name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{invested > 0 ? Math.round((value / invested) * 100) + "% of portfolio" : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 14 }}>{usd(value)}</div>
                <div className="tnum" style={{ fontSize: 12, fontWeight: 600, color: dcol(day) }}>{pctStr(day)}</div>
              </div>
            </button>
          );
        })}
        {holdings.length === 0 && (
          <div style={{ padding: "12px 12px 14px", fontSize: 13, color: "var(--ink-3)" }}>Nothing invested yet — tell me a goal below and I&rsquo;ll build your first plan.</div>
        )}
      </div>
    </div>
  );
}

// ── proposed plan card ──────────────────────────────────────────────────────

// Map a 0..10000 bps risk score to the 1..5 meter + a friendly label (old PlanScreen).
function riskMeta(bps: number): { level: number; label: string } {
  const v = Math.max(0, Math.min(100, bps / 100));
  if (v < 20) return { level: 1, label: "Very steady" };
  if (v < 40) return { level: 2, label: "Cautious" };
  if (v < 60) return { level: 3, label: "Balanced" };
  if (v < 80) return { level: 4, label: "Adventurous" };
  return { level: 5, label: "Bold" };
}

// Dual equity curve: the proposed mix (primary, filled) vs SPY (dashed) — the
// old PlanScreen's backtest chart, both series normalized to 100 server-side.
function BacktestChart({ bt }: { bt: NonNullable<AllocateResult["backtest"]> }) {
  const W = 300, H = 76;
  const all = [...bt.portfolio.curve, ...bt.benchmark.curve];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const pts = (curve: number[]) =>
    curve.map((v, i) => `${((i / (curve.length - 1)) * W).toFixed(1)},${(H - 6 - ((v - min) / span) * (H - 12)).toFixed(1)}`).join(" ");
  const planPts = pts(bt.portfolio.curve);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }} role="img"
      aria-label={`Backtest: this mix ${bt.portfolio.returnPct >= 0 ? "up" : "down"} ${Math.abs(bt.portfolio.returnPct).toFixed(1)}% over 12 months, S&P 500 ${bt.benchmark.returnPct >= 0 ? "up" : "down"} ${Math.abs(bt.benchmark.returnPct).toFixed(1)}%`}>
      <polygon points={`0,${H} ${planPts} ${W},${H}`} fill="var(--primary)" opacity={0.12} />
      <polyline points={pts(bt.benchmark.curve)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline points={planPts} fill="none" stroke="var(--primary)" strokeWidth={2.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** "What could this cost me in a bad stretch?" — the plan's risk as a plain
 *  dollar sentence from the REAL worst dip; qualitative when out of scope. */
function ExplainRisk({ plan }: { plan: AllocateResult }) {
  const [open, setOpen] = useState(false);
  const drawdownPct = plan.backtest?.portfolio.maxDrawdownPct;
  const hasDollars = typeof drawdownPct === "number" && plan.amountUsd > 0;
  const worstDrop = hasDollars ? ((drawdownPct as number) / 100) * plan.amountUsd : 0;
  const v = Math.max(0, Math.min(100, plan.riskScore / 100));
  const lean = v < 40
    ? "It leans steady, so day to day it should move less than the market."
    : v < 70
      ? "It sits in the middle, so expect some ups and downs along the way."
      : "It leans bold, so it can swing more than the market in both directions.";
  return (
    <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", background: "none", textAlign: "left" }}>
        <PIcon name="ph-shield" size={15} weight="bold" style={{ color: "var(--primary)", flex: "none" }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>What could this cost me in a bad stretch?</span>
        <PIcon name="ph-caret-down" size={13} weight="bold" style={{ color: "var(--ink-3)", flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .26s ease" }} />
      </button>
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .3s ease" }}>
        <div style={{ overflow: "hidden" }}>
          <p style={{ margin: 0, padding: "0 13px 12px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {hasDollars ? (
              <>A rough patch for a mix like this has meant a drop of about <b className="tnum" style={{ color: "var(--ink)" }}>{usd(worstDrop)}</b> on your <b className="tnum" style={{ color: "var(--ink)" }}>{usd(plan.amountUsd)}</b> at its worst in the last year. It recovered, but nothing guarantees that.</>
            ) : (
              <>{lean} There is not enough public history in this mix yet to put a firm dollar figure on the worst-case dip.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanCard({ plan, live, canInvest, onInvest, onNudge, nav }: {
  plan: AllocateResult;
  live: boolean;
  canInvest: boolean;
  onInvest: () => void;
  onNudge: (tone: NudgeTone) => void;
  nav: ChatNav;
}) {
  const amountStr = usd(plan.amountUsd);
  const riskLabel = plan.riskScore < 2500 ? "steady" : plan.riskScore < 5500 ? "balanced" : plan.riskScore < 8000 ? "adventurous" : "bold";
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, marginTop: 14, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--primary)" }}>Proposed plan · {amountStr}</span>
        <button onClick={() => nav.openCanvas("portfolio")} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          Expand <PIcon name="ph-arrow-square-out" size={12} weight="bold" />
        </button>
      </div>
      <div className="wipe" style={{ display: "flex", height: 12, borderRadius: 99, overflow: "hidden", gap: 2, marginBottom: 16 }}>
        {plan.allocations.map((a) => (
          <div key={a.symbol} style={{ width: a.weightPct + "%", background: displayFor(a.symbol).color }} />
        ))}
      </div>
      {/* rows cascade in behind the bar wipe — the plan "assembling itself" */}
      {plan.allocations.map((a, i) => (
        <button key={a.symbol} className="msg" onClick={() => nav.openCanvas("holding", a.symbol)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "9px 4px", borderTop: "1px solid var(--line-2)", borderRadius: 8, animationDelay: `${0.18 + Math.min(i, 7) * 0.05}s` }}>
          <AssetTile asset={toTile(a.symbol)} size={34} radius={10} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{displayFor(a.symbol).name} <span style={{ fontWeight: 500, fontSize: 11, color: "var(--ink-3)" }}>· {catFor(a.symbol)}</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.reason}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 14 }}>{usd((plan.amountUsd * a.weightPct) / 100)}</div>
            <div className="tnum" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{Math.round(a.weightPct)}%</div>
          </div>
        </button>
      ))}
      {/* the old app's overall explanation — why this mix, in Vera's words */}
      {plan.rationale && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 5 }}>Why this mix</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>{plan.rationale}</div>
        </div>
      )}
      {/* how bumpy this could feel — the old risk meter, 1..5 */}
      {(() => {
        const risk = riskMeta(plan.riskScore);
        return (
          <div style={{ marginTop: 12, padding: "12px 13px", borderRadius: 14, background: "var(--panel-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>How bumpy this could feel</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary)" }}>{risk.label}</span>
            </div>
            <RiskMeter level={risk.level} />
          </div>
        );
      })()}
      <ExplainRisk plan={plan} />
      {/* how this mix held up — real 12-month curve vs the S&P, never faked */}
      {plan.backtest && (
        <div style={{ marginTop: 10, padding: "12px 13px", borderRadius: 14, background: "var(--panel-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>How this mix held up</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>last 12 months</span>
          </div>
          <BacktestChart bt={plan.backtest} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {[
              { label: "This mix", v: plan.backtest.portfolio.returnPct, signed: true },
              { label: "S&P 500", v: plan.backtest.benchmark.returnPct, signed: true },
              { label: "Worst dip", v: -Math.abs(plan.backtest.portfolio.maxDrawdownPct), signed: false },
            ].map((st) => (
              <div key={st.label} style={{ flex: 1, textAlign: "center" }}>
                <div className="tnum" style={{ fontSize: 14, fontWeight: 700, color: st.v >= 0 ? "var(--pos)" : "var(--neg)" }}>
                  {(st.v >= 0 && st.signed ? "+" : "") + st.v.toFixed(1)}%
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>{st.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
            {plan.backtest.coveragePct < 100 && `Covers ${Math.round(plan.backtest.coveragePct)}% of the mix (${plan.backtest.excluded.join(", ")} ${plan.backtest.excluded.length === 1 ? "has" : "have"} no public history yet). `}
            Rebalanced monthly. History, not a promise: markets change.
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>
        <PIcon name="ph-seal-check" size={15} weight="fill" style={{ color: "var(--primary)" }} />
        Risk {riskLabel} · signed on-chain before anything moves · the price includes the quoted spread · gas on us
      </div>
      {live && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={onInvest} disabled={!canInvest} title={canInvest ? undefined : "Add cash to invest this plan"} style={{ flex: 1, minWidth: 150, height: 48, borderRadius: 14, fontSize: 15, fontWeight: 600, color: "var(--primary-ink)", background: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: canInvest ? 1 : 0.5, cursor: canInvest ? "pointer" : "default" }}>
            <PIcon name="ph-check-circle" size={17} weight="fill" /> Invest {amountStr}
          </button>
          {/* naked hairline pills — no glass-inside-glass */}
          {NUDGES.map(([tone, label]) => (
            <button key={tone} onClick={() => onNudge(tone)} style={{ height: 48, padding: "0 15px", border: "1px solid var(--line)", borderRadius: 14, fontSize: 13.5, fontWeight: 600, background: "transparent", color: "var(--ink-2)" }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── portfolio review card ───────────────────────────────────────────────────

/** Shape of /api/portfolio-review + veraRouter's review payload (subset we render). */
interface ReviewPayload {
  concentration: { topSymbol: string; topWeightPct: number; top3WeightPct: number; holdingsCount: number };
  themes: { theme: string; symbols: string[]; weightPct: number }[];
  backtest?: AllocateResult["backtest"];
  narrative: {
    verdict: string;
    observations: string[];
    nudges: { title: string; detail: string; kind: "diversify" | "trim" | "steady" | "none" }[];
  };
}

/** "How does my portfolio look?" as a card, not a paragraph: the same numbers
 *  the engine computes — concentration, themes, the mix's own 12-month curve
 *  vs the S&P — with each nudge tappable. Weights never get a "+" sign. */
function ReviewCard({ review, onAsk, nav }: { review: ReviewPayload; onAsk: (text: string) => void; nav: ChatNav }) {
  const c = review.concentration;
  const n = review.narrative;
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, marginTop: 14, padding: "18px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 10 }}>
        Portfolio review · {c.holdingsCount} holding{c.holdingsCount === 1 ? "" : "s"}
      </div>
      {/* concentration — the shape of the money */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: `Biggest · ${c.topSymbol}`, v: `${c.topWeightPct.toFixed(0)}%` },
          { label: "Top 3 together", v: `${c.top3WeightPct.toFixed(0)}%` },
          { label: "Holdings", v: String(c.holdingsCount) },
        ].map((st) => (
          <div key={st.label} style={{ flex: 1, padding: "9px 10px", borderRadius: 12, background: "var(--panel-2)", textAlign: "center" }}>
            <div className="tnum" style={{ fontSize: 14.5, fontWeight: 700 }}>{st.v}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>{st.label}</div>
          </div>
        ))}
      </div>
      {/* themes that move together */}
      {review.themes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {review.themes.map((t) => (
            <span key={t.theme} style={{ padding: "5px 10px", borderRadius: 999, border: "1px solid var(--line)", fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)" }}>
              {t.theme} · {t.symbols.join("+")} · {t.weightPct.toFixed(0)}%
            </span>
          ))}
        </div>
      )}
      {/* the mix's own 12-month history vs SPY — reuses the plan card's chart */}
      {review.backtest && (
        <div style={{ marginTop: 12, padding: "12px 13px", borderRadius: 14, background: "var(--panel-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>This mix over 12 months</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>the mix&rsquo;s history, not your return</span>
          </div>
          <BacktestChart bt={review.backtest} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {[
              { label: "This mix", v: review.backtest.portfolio.returnPct, signed: true },
              { label: "S&P 500", v: review.backtest.benchmark.returnPct, signed: true },
              { label: "Worst dip", v: -Math.abs(review.backtest.portfolio.maxDrawdownPct), signed: false },
            ].map((st) => (
              <div key={st.label} style={{ flex: 1, textAlign: "center" }}>
                <div className="tnum" style={{ fontSize: 14, fontWeight: 700, color: st.v >= 0 ? "var(--pos)" : "var(--neg)" }}>
                  {(st.v >= 0 && st.signed ? "+" : "") + st.v.toFixed(1)}%
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* observations */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        {n.observations.map((o) => (
          <div key={o} style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--primary)", flex: "none", marginTop: 7 }} />{o}
          </div>
        ))}
      </div>
      {/* nudges — each one actionable, routed by its kind */}
      {n.nudges.filter((g) => g.kind !== "none").length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {n.nudges.filter((g) => g.kind !== "none").map((g) => (
            <button
              key={g.title}
              onClick={() => {
                if (g.kind === "trim") {
                  const sym = review.concentration.topSymbol;
                  if (sym) { nav.openSell(sym); return; }
                }
                onAsk(g.title);
              }}
              style={{ textAlign: "left", padding: "11px 13px", borderRadius: 14, border: "1px solid var(--line)", background: "transparent" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                <PIcon name={g.kind === "trim" ? "ph-scissors" : g.kind === "steady" ? "ph-shield-check" : "ph-arrows-out"} size={14} weight="bold" style={{ color: "var(--primary)" }} />
                {g.title}
                <PIcon name="ph-arrow-right" size={12} weight="bold" style={{ marginLeft: "auto", color: "var(--ink-3)" }} />
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 3 }}>{g.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── mode chooser ────────────────────────────────────────────────────────────

/** The old ConfirmScreen's choice, chat-styled: one tap (Vera signs each
 *  holding silently) or maximum control (approve every signature yourself). */
function ModeChooser({ plan, onChoose, onClose }: { plan: AllocateResult; onChoose: (m: "auto" | "manual") => void; onClose: () => void }) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const holdings = (plan.allocations ?? []).length;
  const OPTIONS = [
    { mode: "auto" as const, icon: "ph-sparkle", title: "Let Vera place it", blurb: `One tap. Vera signs each of the ${holdings} holdings for you and you watch it happen.` },
    { mode: "manual" as const, icon: "ph-shield-check", title: "Approve each step", blurb: `You confirm every signature in your wallet, ${holdings} approvals in a row.` },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 140, display: "grid", placeItems: "center", padding: 16, background: "color-mix(in srgb, #000 40%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(430px, 100%)", borderRadius: 22, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "0 24px 70px rgba(0,0,0,.35)", padding: "18px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChatOrb size={30} />
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontSize: 19, fontWeight: 500 }}>How should we place it?</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{usd(plan.amountUsd)} across {holdings} holdings. Both ways buy the exact plan you reviewed.</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: "var(--panel-2)", display: "grid", placeItems: "center", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {OPTIONS.map((o) => {
            const on = mode === o.mode;
            return (
              <button key={o.mode} onClick={() => setMode(o.mode)} style={{ textAlign: "left", display: "flex", gap: 11, alignItems: "flex-start", padding: "13px 14px", borderRadius: 16, border: `1.5px solid ${on ? "var(--primary)" : "var(--line)"}`, background: on ? "var(--primary-soft)" : "transparent", transition: "border-color .18s, background .18s" }}>
                <span style={{ width: 34, height: 34, borderRadius: 11, flex: "none", display: "grid", placeItems: "center", background: on ? "var(--primary)" : "var(--panel-2)", color: on ? "var(--primary-ink)" : "var(--primary)" }}>
                  <PIcon name={o.icon} size={17} weight="fill" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{o.title}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45, marginTop: 2 }}>{o.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={() => onChoose(mode)} style={{ width: "100%", height: 48, marginTop: 14, borderRadius: 15, fontSize: 14.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <PIcon name="ph-check-circle" size={17} weight="fill" /> {mode === "auto" ? `Place my plan — ${usd(plan.amountUsd)}` : "Approve and place"}
        </button>
        <div style={{ marginTop: 9, fontSize: 11, color: "var(--ink-3)", textAlign: "center" }}>Self-custody either way. Your funds stay yours the whole time.</div>
      </div>
    </div>
  );
}

/** Sell twin of ModeChooser: one tap (Vera signs each sale) or approve-each. */
function SellModeChooser({ totalUsd, count, onChoose, onClose }: { totalUsd: number; count: number; onChoose: (m: "auto" | "manual") => void; onClose: () => void }) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const OPTIONS = [
    { mode: "auto" as const, icon: "ph-sparkle", title: "Let Vera place it", blurb: `One tap. Vera signs each of the ${count} sale${count === 1 ? "" : "s"} for you and you watch the cash come back.` },
    { mode: "manual" as const, icon: "ph-shield-check", title: "Approve each step", blurb: `You confirm every signature in your wallet, ${count} approval${count === 1 ? "" : "s"} in a row.` },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 140, display: "grid", placeItems: "center", padding: 16, background: "color-mix(in srgb, #000 40%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(430px, 100%)", borderRadius: 22, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "0 24px 70px rgba(0,0,0,.35)", padding: "18px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChatOrb size={30} />
          <div style={{ flex: 1 }}>
            <div className="serif" style={{ fontSize: 19, fontWeight: 500 }}>How should we sell it?</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>About {usd(totalUsd)} back to cash across {count} holding{count === 1 ? "" : "s"}, at live quotes.</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: "var(--panel-2)", display: "grid", placeItems: "center", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {OPTIONS.map((o) => {
            const on = mode === o.mode;
            return (
              <button key={o.mode} onClick={() => setMode(o.mode)} style={{ textAlign: "left", display: "flex", gap: 11, alignItems: "flex-start", padding: "13px 14px", borderRadius: 16, border: `1.5px solid ${on ? "var(--primary)" : "var(--line)"}`, background: on ? "var(--primary-soft)" : "transparent", transition: "border-color .18s, background .18s" }}>
                <span style={{ width: 34, height: 34, borderRadius: 11, flex: "none", display: "grid", placeItems: "center", background: on ? "var(--primary)" : "var(--panel-2)", color: on ? "var(--primary-ink)" : "var(--primary)" }}>
                  <PIcon name={o.icon} size={17} weight="fill" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{o.title}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45, marginTop: 2 }}>{o.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={() => onChoose(mode)} style={{ width: "100%", height: 48, marginTop: 14, borderRadius: 15, fontSize: 14.5, fontWeight: 700, background: "var(--neg)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <PIcon name="ph-check-circle" size={17} weight="fill" /> {mode === "auto" ? `Sell about ${usd(totalUsd)} to cash` : "Approve and sell"}
        </button>
        <div style={{ marginTop: 9, fontSize: 11, color: "var(--ink-3)", textAlign: "center" }}>Self-custody either way. Proceeds land as USDG in your wallet.</div>
      </div>
    </div>
  );
}

// ── success card ────────────────────────────────────────────────────────────

function SuccessCard({ s, nav }: { s: InvestSuccess; nav: ChatNav }) {
  const [receipt, setReceipt] = useState(false);
  return (
    <>
      <div style={{ marginTop: 14, border: "1px solid var(--primary)", borderRadius: 20, background: "var(--primary-soft)", padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <span className="pop" style={{ width: 44, height: 44, borderRadius: "50%", flex: "none", background: "var(--primary)", display: "grid", placeItems: "center" }}>
          <PIcon name="ph-check" size={22} weight="bold" style={{ color: "var(--primary-ink)" }} />
        </span>
        <div style={{ flex: 1 }}>
          <div className="serif" style={{ fontSize: 19, fontWeight: 500 }}>You&rsquo;re invested.</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 1 }}>{usd(s.amountUsd)} across {(s.holdings ?? []).length} holdings, verified on-chain before the money moved.</div>
        </div>
        <button onClick={() => setReceipt(true)} style={{ flex: "none", height: 38, padding: "0 14px", borderRadius: 12, fontSize: 13, fontWeight: 600, background: "var(--primary)", color: "var(--primary-ink)" }}>View</button>
      </div>
      {receipt && <InvestReceiptPopup s={s} nav={nav} onClose={() => setReceipt(false)} />}
    </>
  );
}

/** The full receipt: every leg with its logo, dollars, and its own tx on
 *  Blockscout, plus the plan on-chain record + risk verification. */
function InvestReceiptPopup({ s, nav, onClose }: { s: InvestSuccess; nav: ChatNav; onClose: () => void }) {
  const holdings = s.holdings ?? [];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 140, display: "grid", placeItems: "center", padding: 16, background: "color-mix(in srgb, #000 40%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 100%)", maxHeight: "86vh", overflowY: "auto", borderRadius: 22, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "16px 18px 12px", display: "flex", alignItems: "center", gap: 11, borderBottom: "1px solid var(--line)" }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", flex: "none", background: "var(--primary)", display: "grid", placeItems: "center" }}>
            <PIcon name="ph-check" size={19} weight="bold" style={{ color: "var(--primary-ink)" }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 18, fontWeight: 500 }}>Your receipt</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{usd(s.amountUsd)} · {holdings.length} holdings · gasless{s.anySettling ? " · some fills settling" : ""}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: "var(--panel-2)", display: "grid", placeItems: "center", color: "var(--ink-2)" }}>
            <PIcon name="ph-x" size={15} weight="bold" />
          </button>
        </div>
        <div style={{ padding: "6px 18px" }}>
          {holdings.map((h) => (
            <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--line-2)" }}>
              <AssetTile asset={toTile(h.symbol, h.name)} size={34} radius={10} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                {h.txHash ? (
                  <a href={`${EXPLORER_TX}${h.txHash}`} target="_blank" rel="noreferrer" className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>
                    <PIcon name="ph-arrow-square-out" size={11} weight="bold" /> {h.txHash.slice(0, 10)}…{h.txHash.slice(-4)}
                  </a>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>settling, lands in minutes</span>
                )}
              </span>
              <span style={{ textAlign: "right" }}>
                <span className="tnum" style={{ display: "block", fontWeight: 650, fontSize: 13.5 }}>{usd(h.amountUsd)}</span>
                <span className="tnum" style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>{Math.round(h.weightPct)}%</span>
              </span>
            </div>
          ))}
          {/* the plan own on-chain record + the risk check it passed */}
          <div style={{ padding: "12px 0 14px", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-2)" }}>
                <PIcon name="ph-seal-check" size={14} weight="fill" style={{ color: "var(--primary)" }} /> Plan recorded on-chain
              </span>
              <a href={`${EXPLORER_TX}${s.txHash}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--primary)" }}>
                {s.txHash.slice(0, 10)}…{s.txHash.slice(-4)} ↗
              </a>
            </div>
            {s.verification && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                Risk {(s.verification.riskScore / 100).toFixed(0)} / ceiling {(s.verification.maxRisk / 100).toFixed(0)} — signed by Vera (agent #{s.verification.agentId}) before the money moved.
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: "0 18px 16px", display: "flex", gap: 8 }}>
          <button onClick={() => { nav.openCanvas("portfolio"); onClose(); }} style={{ flex: 1, height: 44, borderRadius: 14, fontSize: 13.5, fontWeight: 700, background: "var(--primary)", color: "var(--primary-ink)" }}>View portfolio</button>
          <button onClick={onClose} style={{ flex: "none", padding: "0 18px", height: 44, borderRadius: 14, fontSize: 13.5, fontWeight: 600, background: "var(--panel-2)", color: "var(--ink-2)" }}>Done</button>
        </div>
      </div>
    </div>
  );
}
