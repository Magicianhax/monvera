// Turn raw wallet transfers (WalletTx, one row per token movement) into
// human-readable money events: Bought / Sold / Sent / Received / Grove trades /
// Staking / internal moves.
//
// A trade settles in ONE transaction with two legs:
//   buy  = USDG out + stock in   -> "Bought AAPL" (cost = the USDG leg)
//   sell = stock out + USDG in   -> "Sold AAPL"   (proceeds = the USDG leg)
// A lone leg is a plain transfer: out -> "Sent USDG", in -> "Received AAPL".
// Grouping is by tx hash, so all legs of a trade collapse into one event.
//
// The feed can now carry rows from BOTH the EOA and the smart account (see
// /api/transactions). That unlocks three classifications that used to lie:
//   - Grove buy: EOA USDG -> smart account -> GroveManager, stocks land at the
//     smart account. Without this, the feed showed "Sent cash · To 0x…".
//   - Grove exit: entirely at the smart account. Used to be invisible.
//   - Internal EOA<->smart moves: the user's own money changing pockets, never
//     a "send to a stranger".
import { USDG } from "@/lib/tokens";
import { GROVE_MANAGER } from "@/lib/groveManager";
import { STAKING_ADDRESSES } from "@/lib/staking";
import type { WalletTx } from "@/lib/walletTx";
import type { IconName } from "@/components/design";

export type WalletEventKind =
  | "buy"
  | "sell"
  | "send"
  | "receive"
  | "groveBuy"
  | "groveExit"
  | "stake"
  | "unstake"
  | "move";

export interface WalletEvent {
  hash: `0x${string}`;
  kind: WalletEventKind;
  /** The asset the event is "about" (the stock for a trade; the token for a transfer). */
  symbol: string;
  /** Human amount of `symbol` moved. */
  amount: number;
  /** USDG spent (buy) or received (sell); undefined for plain transfers. */
  usdgAmount?: number;
  /** Other party for a plain transfer (undefined for trades). */
  counterparty?: string;
  /** Grove events: how many stock legs the basket moved. */
  legs?: number;
  /** "move" events: which of the user's own accounts received the money. */
  moveTo?: "smart" | "eoa";
  blockNumber: number;
  timestamp?: number;
}

/** Optional addresses that unlock grove/staking/internal classification.
 *  Without them the function behaves exactly as before (trades + transfers). */
export interface ActivityContext {
  /** The user's EOA (the address the feed was requested for), any case. */
  eoa?: string;
  /** The user's ERC-4337 smart account, any case. */
  smartAccount?: string;
}

const isUsdg = (t: WalletTx) => t.symbol === USDG.symbol;

/** Collapse per-token transfers into money events, newest first. */
export function toWalletEvents(txs: WalletTx[], ctx?: ActivityContext): WalletEvent[] {
  const grove = (GROVE_MANAGER || "").toLowerCase();
  const staking = STAKING_ADDRESSES.staking.toLowerCase();
  const own = new Set(
    [ctx?.eoa, ctx?.smartAccount].filter((a): a is string => Boolean(a)).map((a) => a.toLowerCase()),
  );
  const isOwn = (addr: string) => own.has(addr.toLowerCase());

  // Group by transaction hash (all legs of a trade share one hash).
  const byHash = new Map<string, WalletTx[]>();
  for (const t of txs) {
    const g = byHash.get(t.hash);
    if (g) g.push(t);
    else byHash.set(t.hash, [t]);
  }

  const events: WalletEvent[] = [];
  for (const [hash, group] of byHash) {
    const block = Math.max(...group.map((t) => t.blockNumber));
    const ts = group.find((t) => t.timestamp)?.timestamp;
    const base = { hash: hash as `0x${string}`, blockNumber: block, timestamp: ts };

    // ── Grove trade: any leg touching GroveManager ──────────────────────────
    if (grove && group.some((t) => t.counterparty.toLowerCase() === grove)) {
      const stocksIn = group.filter((t) => t.account === "smart" && t.direction === "in" && !isUsdg(t) && t.amount > 0);
      const stocksOut = group.filter((t) => t.account === "smart" && t.direction === "out" && !isUsdg(t) && t.amount > 0);
      if (stocksIn.length >= stocksOut.length && stocksIn.length > 0) {
        // Buy: the cost is the USDG that left the EOA for it (falls back to the
        // smart account's USDG-out when only the smart sweep saw the tx).
        const cost =
          group.find((t) => isUsdg(t) && t.account !== "smart" && t.direction === "out")?.amount ??
          group.find((t) => isUsdg(t) && t.direction === "out")?.amount;
        events.push({ ...base, kind: "groveBuy", symbol: stocksIn[0].symbol, amount: stocksIn[0].amount, usdgAmount: cost, legs: stocksIn.length });
      } else if (stocksOut.length > 0) {
        // Exit: proceeds = USDG landing at the smart account (net of any fee).
        const proceeds = group
          .filter((t) => isUsdg(t) && t.direction === "in" && t.account === "smart")
          .reduce((s, t) => s + t.amount, 0);
        events.push({ ...base, kind: "groveExit", symbol: stocksOut[0].symbol, amount: stocksOut[0].amount, usdgAmount: proceeds || undefined, legs: stocksOut.length });
      } else {
        // Grove touched but no stock legs visible (partial index) — internal.
        const r = group[0];
        events.push({ ...base, kind: "move", symbol: r.symbol, amount: r.amount, moveTo: r.direction === "out" ? "smart" : "eoa" });
      }
      continue;
    }

    // ── Staking: $MONVERA to/from MonveraStaking ────────────────────────────
    const stakeLeg = group.find((t) => t.counterparty.toLowerCase() === staking && t.amount > 0);
    if (stakeLeg) {
      events.push({
        ...base,
        kind: stakeLeg.direction === "out" ? "stake" : "unstake",
        symbol: stakeLeg.symbol,
        amount: stakeLeg.amount,
      });
      continue;
    }

    // ── Purely internal: every leg is EOA<->smart. One "move", never a send. ──
    if (own.size > 0 && group.every((t) => isOwn(t.counterparty))) {
      const r = group.find((t) => t.account !== "smart") ?? group[0];
      if (r.amount > 0) {
        events.push({ ...base, kind: "move", symbol: r.symbol, amount: r.amount, moveTo: r.direction === "out" ? "smart" : "eoa" });
      }
      continue;
    }

    // Mixed groups: the EOA<->smart legs are plumbing inside a bigger action
    // (e.g. a token buy that sweeps output home) — drop them so the real legs
    // classify cleanly, and dedupe the same movement seen from both accounts.
    const seen = new Set<string>();
    const legs = group.filter((t) => {
      if (own.size > 0 && isOwn(t.counterparty)) return false;
      const key = `${t.tokenAddress}:${t.direction}:${t.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const usdgLeg = legs.find(isUsdg);
    const assetLeg = legs.find((t) => !isUsdg(t) && t.amount > 0);

    if (usdgLeg && assetLeg && usdgLeg.direction !== assetLeg.direction) {
      // Two opposing legs → a trade.
      const kind: WalletEventKind = assetLeg.direction === "in" ? "buy" : "sell";
      events.push({ ...base, kind, symbol: assetLeg.symbol, amount: assetLeg.amount, usdgAmount: usdgLeg.amount });
      continue;
    }

    // Otherwise each leg is a plain transfer of its own.
    for (const t of legs) {
      if (t.amount <= 0) continue;
      events.push({
        ...base,
        kind: t.direction === "in" ? "receive" : "send",
        symbol: t.symbol,
        amount: t.amount,
        counterparty: t.counterparty,
        blockNumber: t.blockNumber,
        timestamp: t.timestamp,
      });
    }
  }

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  return events;
}

/** UI label + icon for an event kind. `positive` = money/asset coming in (green). */
export function eventLabel(e: WalletEvent): { verb: string; icon: IconName; positive: boolean } {
  switch (e.kind) {
    case "buy":
      return { verb: "Bought", icon: "spark", positive: false };
    case "sell":
      return { verb: "Sold", icon: "trend", positive: true };
    case "groveBuy":
      return { verb: "Bought", icon: "spark", positive: false };
    case "groveExit":
      return { verb: "Exited", icon: "trend", positive: true };
    case "stake":
      return { verb: "Staked", icon: "arrowUR", positive: false };
    case "unstake":
      return { verb: "Unstaked", icon: "arrowDR", positive: true };
    case "move":
      return { verb: "Moved", icon: "arrowUR", positive: false };
    case "send":
      return { verb: "Sent", icon: "arrowUR", positive: false };
    case "receive":
      return { verb: "Received", icon: "arrowDR", positive: true };
  }
}
