import "server-only";

// Wallet transaction history (incoming + outgoing token transfers) on Robinhood Chain.
//
// Two indexed sources, tried in order:
//   1. Alchemy `alchemy_getAssetTransfers` (Robinhood is Alchemy-native infra) —
//      one indexed call per direction, filtered to our token set. Clean + fast,
//      but the enhanced API is throttled on lower tiers (429).
//   2. Blockscout Etherscan-compatible `account/tokentx` (keyless, always up) —
//      the reliable fallback when Alchemy is rate-limited or unset.
// Etherscan V2 is NOT used: it does not index Robinhood Chain (chainId 4663).
import { formatUnits, isAddress } from "viem";
import { EXPLORER_URL } from "@/lib/chain";
import { USDG, ALL_ASSETS } from "@/lib/tokens";
import { MONVERA } from "@/lib/monveraToken";
import type { WalletTx } from "@/lib/walletTx";

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_URL = ALCHEMY_KEY ? `https://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null;
const MAX = 50;

/** Which data source the history will use (surfaced in the API response). */
export const TXN_SOURCE: "alchemy" | "blockscout" = ALCHEMY_URL ? "alchemy" : "blockscout";

// Known tokens: address(lowercase) -> { symbol, decimals } so transfers get our labels.
const TOKENS = new Map<string, { symbol: string; decimals: number }>();
TOKENS.set(USDG.address.toLowerCase(), { symbol: USDG.symbol, decimals: USDG.decimals });
for (const a of ALL_ASSETS) {
  if (a.address && a.decimals) TOKENS.set(a.address.toLowerCase(), { symbol: a.symbol, decimals: a.decimals });
}
// The project token: without it, a MONVERA swap's token leg is invisible and
// the paired USDG leg mislabels as "Sent cash" instead of Bought/Sold MONVERA.
TOKENS.set(MONVERA.address.toLowerCase(), { symbol: "MONVERA", decimals: MONVERA.decimals });
const KNOWN_ADDRS = [...TOKENS.keys()];

function dedupeSort(txs: WalletTx[]): WalletTx[] {
  const seen = new Set<string>();
  const unique = txs.filter((t) => {
    const key = `${t.hash}:${t.direction}:${t.tokenAddress}:${t.counterparty}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => b.blockNumber - a.blockNumber);
  return unique.slice(0, MAX);
}

// ── 1) Alchemy getAssetTransfers ───────────────────────────────────────────────
interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  blockNum: string;
  rawContract?: { address?: string; decimal?: string };
  metadata?: { blockTimestamp?: string };
}

async function alchemyRpc(params: Record<string, unknown>): Promise<{ transfers?: AlchemyTransfer[] }> {
  const res = await fetch(ALCHEMY_URL as string, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [params] }),
  });
  const json = (await res.json()) as { result?: { transfers?: AlchemyTransfer[] }; error?: { code: number; message: string } };
  if (json.error) throw new Error(`alchemy ${json.error.code}`);
  return json.result ?? {};
}

async function viaAlchemy(address: string): Promise<WalletTx[]> {
  const base = {
    fromBlock: "0x0",
    toBlock: "latest",
    category: ["erc20"],
    contractAddresses: KNOWN_ADDRS,
    maxCount: "0x32", // 50
    order: "desc",
    withMetadata: true,
  };
  const [out, incoming] = await Promise.all([
    alchemyRpc({ ...base, fromAddress: address }),
    alchemyRpc({ ...base, toAddress: address }),
  ]);
  const map = (t: AlchemyTransfer, direction: "in" | "out"): WalletTx => {
    const tokenAddr = (t.rawContract?.address ?? "").toLowerCase();
    const known = TOKENS.get(tokenAddr);
    const iso = t.metadata?.blockTimestamp;
    const ts = iso ? Math.floor(Date.parse(iso) / 1000) : undefined;
    return {
      hash: t.hash as `0x${string}`,
      direction,
      symbol: known?.symbol ?? t.asset ?? "?",
      amount: typeof t.value === "number" ? t.value : 0,
      counterparty: direction === "out" ? t.to : t.from,
      tokenAddress: tokenAddr,
      blockNumber: parseInt(t.blockNum, 16) || 0,
      timestamp: ts && Number.isFinite(ts) ? ts : undefined,
    };
  };
  const outT = (out.transfers ?? []).map((t) => map(t, "out"));
  const inT = (incoming.transfers ?? []).map((t) => map(t, "in"));
  return dedupeSort([...outT, ...inT]);
}

// ── 2) Blockscout (Etherscan-compatible, keyless) ──────────────────────────────
interface EsTransfer {
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  blockNumber: string;
  timeStamp: string;
}

async function viaBlockscout(address: string): Promise<WalletTx[]> {
  const url = `${EXPLORER_URL}/api?module=account&action=tokentx&address=${address}&page=1&offset=${MAX * 2}&sort=desc`;
  const res = await fetch(url);
  const json = (await res.json()) as { status: string; message: string; result: EsTransfer[] | string };
  if (json.status !== "1" || !Array.isArray(json.result)) return [];

  const lc = address.toLowerCase();
  const txs = json.result
    .filter((t) => TOKENS.has((t.contractAddress ?? "").toLowerCase()))
    .map((t): WalletTx => {
      const out = t.from?.toLowerCase() === lc;
      const tokenAddr = t.contractAddress?.toLowerCase() ?? "";
      const known = TOKENS.get(tokenAddr);
      const decimals = known?.decimals ?? (Number(t.tokenDecimal) || 18);
      let amount = 0;
      try {
        amount = Number(formatUnits(BigInt(t.value), decimals));
      } catch {
        amount = 0;
      }
      const ts = Number(t.timeStamp);
      return {
        hash: t.hash as `0x${string}`,
        direction: out ? "out" : "in",
        symbol: known?.symbol ?? t.tokenSymbol ?? "?",
        amount,
        counterparty: out ? t.to : t.from,
        tokenAddress: tokenAddr,
        blockNumber: Number(t.blockNumber) || 0,
        timestamp: Number.isFinite(ts) && ts > 0 ? ts : undefined,
      };
    });
  return dedupeSort(txs);
}

/** Incoming + outgoing transfers for `address`, newest first. Alchemy first,
 *  Blockscout fallback (used whenever Alchemy is unset or rate-limited). */
export async function getWalletTransfers(address: string): Promise<WalletTx[]> {
  if (!isAddress(address)) return [];
  if (ALCHEMY_URL) {
    try {
      return await viaAlchemy(address);
    } catch {
      /* rate-limited / unsupported — fall back to Blockscout */
    }
  }
  try {
    return await viaBlockscout(address);
  } catch {
    return [];
  }
}
