// $MONVERA — the project token, launched via Virtuals Protocol on Robinhood
// Chain (13 Jul 2026). Single source of truth for its addresses, the Uniswap v2
// route it trades over, and the 100k holder gate. All values verified on-chain
// 2026-07-14 (see tasks/plans/2026-07-14-token-layer-plan.md).
//
// Route: USDG <-> VIRTUAL <-> MONVERA over two v2 pairs (~$125k liq each).
// The direct MONVERA/USDG v4 pool has ~$1k liquidity — never price or route
// through it. MONVERA has NO EIP-2612 permit (probed: nonces() reverts).
import { parseAbi } from "viem";
import { USDG } from "@/lib/tokens";

export const MONVERA = {
  address: "0x7541872e32Bb529d7FF11D6C59832269ce33a6FF" as `0x${string}`,
  symbol: "MONVERA",
  decimals: 18,
} as const;

export const VIRTUAL = {
  address: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31" as `0x${string}`,
  symbol: "VIRTUAL",
  decimals: 18,
} as const;

/** UniswapV2Router02 — verified contract, factory-matched to both pairs below. */
export const V2_ROUTER = "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba" as `0x${string}`;
/** MONVERA/VIRTUAL v2 pair — the main pool (chart + price source). */
export const MONVERA_PAIR = "0x502Be3da0Ad1c83C79A9e64Ac5A05eEc39A44c78" as `0x${string}`;

/** Hold this much MONVERA to unlock holder features (Scan to Buy). ~$100 at launch. */
export const HOLDER_THRESHOLD = BigInt(100_000) * BigInt(10) ** BigInt(18);

export const BUY_PATH = [USDG.address, VIRTUAL.address, MONVERA.address] as `0x${string}`[];
export const SELL_PATH = [MONVERA.address, VIRTUAL.address, USDG.address] as `0x${string}`[];

// The fee-on-transfer swap variant is used for BOTH directions: Virtuals agent
// tokens can carry a swap tax, and the variant is identical to the plain one
// when there is none.
export const V2_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);

export const ERC20_MINI_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
]);

/** Default slippage: 3% — thin pools + possible Virtuals swap tax. */
export function applySlippage(amount: bigint, bps = 300): bigint {
  return (amount * (BigInt(10_000) - BigInt(bps))) / BigInt(10_000);
}

// GeckoTerminal, not DexScreener: it is the same source the token chart already
// reads (CoinGecko's on-chain API), so the linked page and our own numbers can
// never disagree — and it needs no paid verification to show the pair properly.
export const MONVERA_LINKS = {
  virtuals: "https://app.virtuals.io/virtuals/105667",
  geckoterminal: "https://www.geckoterminal.com/robinhood/pools/0x502Be3da0Ad1c83C79A9e64Ac5A05eEc39A44c78",
  chartEmbed:
    "https://www.geckoterminal.com/robinhood/pools/0x502Be3da0Ad1c83C79A9e64Ac5A05eEc39A44c78?embed=1&info=0&swaps=0&light_chart=0",
  blockscoutToken:
    "https://robinhoodchain.blockscout.com/token/0x7541872e32Bb529d7FF11D6C59832269ce33a6FF",
} as const;
