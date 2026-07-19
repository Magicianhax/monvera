import "server-only";

// Uniswap v4 as a DIRECT execution venue for stocks on Robinhood Chain.
// Official 4663 deployment (developers.uniswap.org/contracts/v4/deployments):
// PoolManager 0x8366a39c…, UniversalRouter 0x88767899…, V4Quoter 0x8dc178ef….
// Real USDG/stock pools exist (0.30% and 1% tiers verified live on AAPL), and
// the encoding below mirrors a production trade through this router byte-for-
// byte (tx 0xca3567f6…: V4_SWAP with SWAP_EXACT_IN + SETTLE + TAKE).
//
// The Uniswap Trading API does NOT cover 4663 yet ("No quotes available"), so
// routing is quoted on-chain via V4Quoter and calldata is built here. Our
// 25 bps integrator fee uses the router's own PAY_PORTION command — the same
// mechanism the Uniswap frontend uses — paid to UNISWAP_FEE_RECIPIENT in the
// output token, atomically in the swap tx. When the Trading API adds 4663,
// UNISWAP_API_KEY (placeholder in env) unlocks API-built routes instead.
//
// Execution model: the relayed smart account (which just pulled the sell token
// from the EOA) runs [approve sellToken→Permit2, Permit2.approve(router),
// UniversalRouter.execute] — returned as generic `steps`. The router TAKEs
// output to itself, PAY_PORTIONs the fee, and SWEEPs the rest straight to the
// EOA, so nothing needs a follow-up transfer and gas stays sponsored.
import { createPublicClient, http, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi, type Address } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";

const QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as Address;
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904" as Address;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
// UniversalRouter recipient sentinel: address(this) — the router itself.
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;

// UniversalRouter command bytes.
const CMD_V4_SWAP = 0x10;
const CMD_PAY_PORTION = 0x06;
const CMD_SWEEP = 0x04;
// v4-periphery action bytes (verified against the live production trade).
const ACT_SWAP_EXACT_IN_SINGLE = 0x06;
const ACT_SETTLE = 0x0b;
const ACT_TAKE = 0x0e;

// Standard fee tier -> tick spacing (hookless pools; the live stock pools use these).
const FEE_TIERS: [number, number][] = [[500, 10], [3000, 60], [10000, 200]];

const SLIPPAGE_BPS = BigInt(50); // 0.5% — consistent with the other fallback venues

function integratorFee(): { bps: bigint; recipient: Address } | null {
  const bps = Number(process.env.UNISWAP_FEE_BPS ?? 0);
  const recipient = process.env.UNISWAP_FEE_RECIPIENT;
  if (!(bps > 0) || !recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) return null;
  return { bps: BigInt(Math.min(bps, 100)), recipient: recipient as Address };
}

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const PERMIT2_ABI = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const ERC20_ABI = parseAbi(["function approve(address, uint256) returns (bool)"]);

interface PoolPick {
  fee: number;
  tickSpacing: number;
  zeroForOne: boolean;
  currency0: Address;
  currency1: Address;
  amountOut: bigint;
}

/** Best hookless pool across the standard fee tiers, or null when none quote. */
async function bestPool(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<PoolPick | null> {
  const zeroForOne = sellToken.toLowerCase() < buyToken.toLowerCase();
  const currency0 = zeroForOne ? sellToken : buyToken;
  const currency1 = zeroForOne ? buyToken : sellToken;
  const probes = await Promise.all(
    FEE_TIERS.map(async ([fee, tickSpacing]) => {
      try {
        const { result } = await client.simulateContract({
          address: QUOTER,
          abi: QUOTER_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey: { currency0, currency1, fee, tickSpacing, hooks: ZERO }, zeroForOne, exactAmount: sellAmount, hookData: "0x" }],
        });
        return { fee, tickSpacing, zeroForOne, currency0, currency1, amountOut: result[0] as bigint };
      } catch {
        return null;
      }
    }),
  );
  const live = probes.filter((p): p is PoolPick => p !== null && p.amountOut > BigInt(0));
  if (live.length === 0) return null;
  live.sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0));
  return live[0];
}

/** Indicative NET price (after our fee) for price mode and tradability probes. */
export async function uniV4Price(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<bigint | null> {
  const pool = await bestPool(sellToken, buyToken, sellAmount).catch(() => null);
  if (!pool) return null;
  const fee = integratorFee();
  return fee ? pool.amountOut - (pool.amountOut * fee.bps) / BigInt(10_000) : pool.amountOut;
}

export interface UniV4Quote {
  /** Expected NET output to the user (after our fee) — comparable across venues. */
  buyAmount: bigint;
  minBuyAmount: bigint;
  /** Executed by the smart account AFTER it pulls `sellAmount` of the sell token. */
  steps: { to: Address; data: `0x${string}`; value: string }[];
}

/**
 * Firm v4 quote + the post-pull call sequence. Output flows router -> fee
 * portion (PAY_PORTION, when configured) -> SWEEP to `recipient` (the EOA).
 * SWEEP's minimum enforces the user's net min-out on-chain.
 */
export async function uniV4Quote(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  recipient: Address,
): Promise<UniV4Quote | null> {
  const pool = await bestPool(sellToken, buyToken, sellAmount).catch(() => null);
  if (!pool) return null;
  const grossMin = pool.amountOut - (pool.amountOut * SLIPPAGE_BPS) / BigInt(10_000);
  if (grossMin <= BigInt(0)) return null;

  const fee = integratorFee();
  const netOf = (v: bigint) => (fee ? v - (v * fee.bps) / BigInt(10_000) : v);

  // V4_SWAP: swap, settle the input from the caller (via Permit2), take the
  // output to the ROUTER so the fee/sweep commands below can split it.
  const actions = encodePacked(["uint8", "uint8", "uint8"], [ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE, ACT_TAKE]);
  const swapParam = encodeAbiParameters(
    [{
      type: "tuple",
      components: [
        {
          type: "tuple", name: "poolKey",
          components: [
            { type: "address", name: "currency0" },
            { type: "address", name: "currency1" },
            { type: "uint24", name: "fee" },
            { type: "int24", name: "tickSpacing" },
            { type: "address", name: "hooks" },
          ],
        },
        { type: "bool", name: "zeroForOne" },
        { type: "uint128", name: "amountIn" },
        { type: "uint128", name: "amountOutMinimum" },
        { type: "bytes", name: "hookData" },
      ],
    }],
    [{
      poolKey: { currency0: pool.currency0, currency1: pool.currency1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: ZERO },
      zeroForOne: pool.zeroForOne,
      amountIn: sellAmount,
      amountOutMinimum: grossMin,
      hookData: "0x",
    }],
  );
  // SETTLE(currency, 0 = open delta, payerIsUser = true) — pulls via Permit2.
  const settleParam = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [sellToken, BigInt(0), true]);
  // TAKE(currency, router, 0 = full delta).
  const takeParam = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [buyToken, ADDRESS_THIS, BigInt(0)]);
  const v4Input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swapParam, settleParam, takeParam]]);

  const commandBytes: number[] = [CMD_V4_SWAP];
  const inputs: `0x${string}`[] = [v4Input];
  if (fee) {
    commandBytes.push(CMD_PAY_PORTION);
    inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [buyToken, fee.recipient, fee.bps]));
  }
  commandBytes.push(CMD_SWEEP);
  inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [buyToken, recipient, netOf(grossMin)]));

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const executeData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "execute",
    args: [encodePacked(commandBytes.map(() => "uint8" as const), commandBytes), inputs, deadline],
  });

  return {
    buyAmount: netOf(pool.amountOut),
    minBuyAmount: netOf(grossMin),
    steps: [
      // The router settles input via Permit2 from its caller (the smart account):
      // sellToken -> Permit2 (exact), then Permit2 -> UniversalRouter (exact).
      { to: sellToken, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [PERMIT2, sellAmount] }), value: "0" },
      { to: PERMIT2, data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [sellToken, UNIVERSAL_ROUTER, sellAmount, Number(deadline)] }), value: "0" },
      { to: UNIVERSAL_ROUTER, data: executeData, value: "0" },
    ],
  };
}
