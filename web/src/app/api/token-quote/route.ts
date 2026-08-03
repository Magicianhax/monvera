// GET /api/token-quote — a fresh buy/sell quote for $MONVERA. Quotes Matcha
// (0x Swap API) and the direct Uniswap v2 router (USDG<->VIRTUAL<->MONVERA)
// side by side and serves whichever guarantees more out. Never cached — quotes go
// stale in seconds and the client batches the returned `tx` into one gasless
// UserOp. `address` = the SMART ACCOUNT that executes the route; `to` = the EOA
// that receives the output. Public but rate-limited per IP.
import type { NextRequest } from "next/server";
import { createPublicClient, http, encodeFunctionData, isAddress } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { USDG } from "@/lib/tokens";
import { MONVERA, V2_ROUTER, V2_ROUTER_ABI, BUY_PATH, SELL_PATH, applySlippage } from "@/lib/monveraToken";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { tooManyRequests, badRequest, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic"; // quotes must be fresh — never cache

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

// Matcha (0x Swap API v2, allowance-holder flow). 0x's canonical AllowanceHolder
// is both the approval spender and the tx target for every route (verified live
// on 4663). The client grants an exact-amount approval to approvalAddress then
// calls tx.to, so both MUST be this address — otherwise a manipulated quote
// could name an attacker contract that pulls the just-approved funds. Anything
// off-pin falls back to the direct router path.
const ZEROX_QUOTE_URL = "https://api.0x.org/swap/allowance-holder/quote";
const ALLOWANCE_HOLDER_4663 = "0x0000000000001ff3684f28c67538d4d072c22734";

interface QuoteBody {
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string;
  tx: { to: string; data: string; value: string };
  source: "matcha" | "router";
  /** matcha only: 0x pays the taker (the smart account), so the client appends
   *  this pre-encoded transfer to hand the output on to the recipient EOA. */
  sweepTx?: { to: string; data: string; value: string };
}

const ERC20_TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** Matcha/0x quote. Returns null on any failure so the caller falls back to the router. */
async function matchaQuote(
  side: "buy" | "sell",
  amount: string,
  address: string,
  to: string,
): Promise<QuoteBody | null> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) return null;
  const sellToken = side === "buy" ? USDG.address : MONVERA.address;
  const buyToken = side === "buy" ? MONVERA.address : USDG.address;

  const url = new URL(ZEROX_QUOTE_URL);
  url.searchParams.set("chainId", "4663");
  url.searchParams.set("sellToken", sellToken);
  url.searchParams.set("buyToken", buyToken);
  url.searchParams.set("sellAmount", amount);
  url.searchParams.set("taker", address);
  url.searchParams.set("slippageBps", "300");

  const res = await fetch(url, {
    headers: { "0x-api-key": key, "0x-version": "v2" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    liquidityAvailable?: boolean;
    buyAmount?: string;
    minBuyAmount?: string;
    transaction?: { to?: string; data?: string; value?: string };
  };
  const tx = json.transaction;
  if (!json.liquidityAvailable || !json.buyAmount || !json.minBuyAmount || !tx?.to || !tx.data) return null;
  if (tx.to.toLowerCase() !== ALLOWANCE_HOLDER_4663) return null;
  const minOut = BigInt(json.minBuyAmount);
  // 0x delivers to the taker (the smart account); forward the guaranteed
  // minimum on to the recipient EOA in the same batch. Static calldata can't
  // name the actual fill — which typically lands near buyAmount, so up to
  // slippageBps of real money would strand on the smart account. The client
  // sweeps that remainder to the EOA right after a Matcha buy settles
  // (see useMonveraSwap).
  const sweep =
    to.toLowerCase() === address.toLowerCase()
      ? undefined
      : {
          to: buyToken,
          data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [to as `0x${string}`, minOut] }),
          value: "0",
        };
  return {
    toAmount: String(BigInt(json.buyAmount)),
    toAmountMin: String(minOut),
    approvalAddress: tx.to,
    tx: { to: tx.to, data: tx.data, value: tx.value ? String(BigInt(tx.value)) : "0" },
    source: "matcha",
    sweepTx: sweep,
  };
}

/** Direct Uniswap v2 router quote — compared against Matcha on every request. */
async function routerQuote(side: "buy" | "sell", amount: bigint, to: string): Promise<QuoteBody> {
  const path = side === "buy" ? BUY_PATH : SELL_PATH;
  const amounts = (await client.readContract({
    address: V2_ROUTER,
    abi: V2_ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [amount, path],
  })) as readonly bigint[];
  const out = amounts[amounts.length - 1] ?? BigInt(0);
  if (out <= BigInt(0)) throw new Error("router: empty quote");
  const minOut = applySlippage(out);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const data = encodeFunctionData({
    abi: V2_ROUTER_ABI,
    functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
    args: [amount, minOut, path, to as `0x${string}`, deadline],
  });
  return {
    toAmount: String(out),
    toAmountMin: String(minOut),
    approvalAddress: V2_ROUTER,
    tx: { to: V2_ROUTER, data, value: "0" },
    source: "router",
  };
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(`token-quote:${clientIp(req)}`, 120, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const url = new URL(req.url);
  const side = url.searchParams.get("side");
  const amountStr = url.searchParams.get("amount");
  const address = url.searchParams.get("address");
  const to = url.searchParams.get("to");
  // prefer=router skips Matcha — the client's retry path after a Matcha route
  // reverted in UserOp simulation.
  const preferRouter = url.searchParams.get("prefer") === "router";

  if (side !== "buy" && side !== "sell") return badRequest("side must be buy or sell.");
  if (!address || !isAddress(address)) return badRequest("Invalid address.");
  if (!to || !isAddress(to)) return badRequest("Invalid recipient address.");
  let amount: bigint;
  try {
    amount = BigInt(amountStr ?? "");
  } catch {
    return badRequest("Invalid amount.");
  }
  if (amount <= BigInt(0)) return badRequest("Amount must be positive.");

  try {
    // Best net output wins: quote Matcha and the direct router side by side and
    // serve whichever guarantees more out (fees are baked into both quotes), so
    // users never get a worse price for the attribution. prefer=router skips
    // Matcha — the client's retry path after a route reverted in simulation.
    const [matcha, router] = await Promise.all([
      preferRouter ? Promise.resolve(null) : matchaQuote(side, String(amount), address, to).catch(() => null),
      routerQuote(side, amount, to).catch(() => null),
    ]);
    const body =
      matcha && (!router || BigInt(matcha.toAmountMin) > BigInt(router.toAmountMin)) ? matcha : router;
    if (!body) throw new Error("no route available");
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("token-quote", err);
  }
}
