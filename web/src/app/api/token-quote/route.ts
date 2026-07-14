// GET /api/token-quote — a fresh buy/sell quote for $MONVERA. Primary route is
// LiFi (verified live on 4663; beats the direct route even after its fee by
// using the deeper WETH pools); on ANY LiFi failure we fall back to the direct
// Uniswap v2 router over USDG<->VIRTUAL<->MONVERA. Never cached — quotes go
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

const LIFI_QUOTE_URL = "https://li.quest/v1/quote";
const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

// LiFi's ONLY contract on Robinhood Chain (its LiFiDiamond — verified via
// li.quest/v1/chains, and it is both the approval spender and the tx target for
// every route). The client grants an exact-amount approval to approvalAddress
// then calls tx.to, so both MUST be this address — otherwise a manipulated
// quote could name an attacker contract that pulls the just-approved funds.
// Anything off-list falls back to the direct router path.
const LIFI_DIAMOND_4663 = "0xb477751b76cf82d00a686a1232f5fcd772414af3";

interface QuoteBody {
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string;
  tx: { to: string; data: string; value: string };
  source: "lifi" | "router";
}

/** LiFi quote. Returns null on any failure so the caller falls back to the router. */
async function lifiQuote(
  side: "buy" | "sell",
  amount: string,
  address: string,
  to: string,
): Promise<QuoteBody | null> {
  const fromToken = side === "buy" ? USDG.address : MONVERA.address;
  const toToken = side === "buy" ? MONVERA.address : USDG.address;

  const url = new URL(LIFI_QUOTE_URL);
  url.searchParams.set("fromChain", "4663");
  url.searchParams.set("toChain", "4663");
  url.searchParams.set("fromToken", fromToken);
  url.searchParams.set("toToken", toToken);
  url.searchParams.set("fromAddress", address);
  url.searchParams.set("toAddress", to);
  url.searchParams.set("fromAmount", amount);
  url.searchParams.set("slippage", "0.03");

  const headers: Record<string, string> = {};
  const key = process.env.LIFI_API_KEY;
  if (key) headers["x-lifi-api-key"] = key; // higher RPM + routing tier; blank = public tier

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    estimate?: { toAmount?: string; toAmountMin?: string; approvalAddress?: string };
    transactionRequest?: { to?: string; data?: string; value?: string };
  };
  const est = json.estimate;
  const tx = json.transactionRequest;
  if (!est?.toAmount || !est.toAmountMin || !est.approvalAddress || !tx?.to || !tx.data) return null;
  // Both the approval spender AND the call target must be LiFi's own diamond —
  // reject (→ router fallback) if either points elsewhere, so a manipulated
  // quote can't redirect the exact-amount approval to a draining contract.
  if (
    est.approvalAddress.toLowerCase() !== LIFI_DIAMOND_4663 ||
    tx.to.toLowerCase() !== LIFI_DIAMOND_4663
  ) {
    return null;
  }
  return {
    toAmount: String(BigInt(est.toAmount)),
    toAmountMin: String(BigInt(est.toAmountMin)),
    approvalAddress: est.approvalAddress,
    // value comes hex ("0x0") — normalize to a decimal string the client BigInt()s.
    tx: { to: tx.to, data: tx.data, value: tx.value ? String(BigInt(tx.value)) : "0" },
    source: "lifi",
  };
}

/** Direct Uniswap v2 router quote — the fallback when LiFi is unavailable. */
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
  // prefer=router skips LiFi — the client's retry path after a LiFi route
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
    let body: QuoteBody | null = null;
    if (!preferRouter) {
      try {
        body = await lifiQuote(side, String(amount), address, to);
      } catch {
        body = null; // any LiFi error -> router fallback
      }
    }
    if (!body) body = await routerQuote(side, amount, to);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError("token-quote", err);
  }
}
