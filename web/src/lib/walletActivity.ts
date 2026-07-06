// Turn raw wallet transfers (WalletTx, one row per token movement) into
// human-readable money events: Bought / Sold / Sent / Received.
//
// A trade settles in ONE transaction with two legs:
//   buy  = USDG out + stock in   -> "Bought AAPL" (cost = the USDG leg)
//   sell = stock out + USDG in   -> "Sold AAPL"   (proceeds = the USDG leg)
// A lone leg is a plain transfer: out -> "Sent USDG", in -> "Received AAPL".
// Grouping is by tx hash, so both legs of a trade collapse into one event.
import { USDG } from "@/lib/tokens";
import type { WalletTx } from "@/lib/walletTx";
import type { IconName } from "@/components/design";

export type WalletEventKind = "buy" | "sell" | "send" | "receive";

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
  blockNumber: number;
  timestamp?: number;
}

const isUsdg = (t: WalletTx) => t.symbol === USDG.symbol;

/** Collapse per-token transfers into buy/sell/send/receive events, newest first. */
export function toWalletEvents(txs: WalletTx[]): WalletEvent[] {
  // Group by transaction hash (both legs of a trade share one hash).
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
    const usdgLeg = group.find(isUsdg);
    const assetLeg = group.find((t) => !isUsdg(t) && t.amount > 0);

    if (usdgLeg && assetLeg && usdgLeg.direction !== assetLeg.direction) {
      // Two opposing legs → a trade.
      const kind: WalletEventKind = assetLeg.direction === "in" ? "buy" : "sell";
      events.push({
        hash: hash as `0x${string}`,
        kind,
        symbol: assetLeg.symbol,
        amount: assetLeg.amount,
        usdgAmount: usdgLeg.amount,
        blockNumber: block,
        timestamp: ts,
      });
      continue;
    }

    // Otherwise each leg is a plain transfer of its own.
    for (const t of group) {
      if (t.amount <= 0) continue;
      events.push({
        hash: hash as `0x${string}`,
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
    case "send":
      return { verb: "Sent", icon: "arrowUR", positive: false };
    case "receive":
      return { verb: "Received", icon: "arrowDR", positive: true };
  }
}
