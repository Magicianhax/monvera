import "server-only";

// KyberSwap Aggregator as an execution venue.
//
// Kyber indexes ~42 DEXes on Robinhood Chain (uniswap-v4, uniswapv3, fermi-prop,
// native-v2, robinswap-v3, giga-v3, sheriff-v4 …) against the single hookless
// Uniswap v4 pool set we quote directly, so it usually returns a better fill on
// the assets we already list — measured better on 17/17 overlapping assets,
// median +0.50%.
//
// DELIBERATELY NOT wired into tradability.ts: `probeVenues` there decides which
// assets are unlocked at all, so adding Kyber to it would silently expand the
// tradable universe. Kyber competes on PRICE for already-unlocked assets only.
//
// Two calls per firm quote:
//   GET  /routes       -> routeSummary (amountOut is NET of our fee, verified:
//                         adding feeAmount=25 moves amountOut exactly -0.2500%)
//   POST /route/build  -> { data, routerAddress } calldata for the smart account
//
// Execution mirrors the LiFi/Uniswap venues: the smart account has already
// pulled the sell token, then runs [approve(router), router.call(data)] and the
// router sends the output straight to the user's EOA (`recipient`).
import { encodeFunctionData, parseAbi, type Address } from "viem";

const BASE = "https://aggregator-api.kyberswap.com/robinhood/api/v1";
// KyberSwap's MetaAggregationRouterV2 on 4663, PINNED.
//
// /route/build returns both the calldata and the address to send it to, and the
// smart account approves that address for the full sell amount before calling
// it. A manipulated or compromised response could therefore name an attacker
// contract and drain the just-approved funds — so the address is pinned to the
// one we verified on-chain (settled fill 0xe769e368…22e01f) and anything else is
// refused outright. Same guard the 0x path uses for AllowanceHolder in
// app/api/token-quote/route.ts. Update ONLY against a verified deployment.
const ROUTER_4663 = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
// Kyber asks integrators to send a stable app name; un-whitelisted clients are
// capped at 3 rps. Register this value with them, don't randomise it per call.
const CLIENT_ID = process.env.KYBER_CLIENT_ID ?? "monvera";
const SLIPPAGE_BPS = 50; // 0.5% — same as the other AMM venues
const BPS = BigInt(10_000);
const TIMEOUT_MS = 9_000;

const ERC20_ABI = parseAbi(["function approve(address, uint256) returns (bool)"]);

/** Our integrator fee, taken in the OUTPUT token like the Uniswap v4 PAY_PORTION
 *  path, and paid to the same wallet. Falls back to the Uniswap settings so the
 *  fee never silently differs between venues. */
function integratorFee(): { feeAmount: string; feeReceiver: string } | null {
  const bps = Number(process.env.KYBER_FEE_BPS ?? process.env.UNISWAP_FEE_BPS ?? 0);
  const recipient = process.env.KYBER_FEE_RECIPIENT ?? process.env.UNISWAP_FEE_RECIPIENT;
  if (!(bps > 0) || !recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) return null;
  return { feeAmount: String(Math.min(bps, 100)), feeReceiver: recipient };
}

interface RouteSummary {
  amountOut: string;
  [k: string]: unknown;
}

/** GET /routes. Returns null on no-route AND on transport/429 failures — Kyber
 *  is never the gate on whether an asset is tradable, so a rate-limited call
 *  just means it does not compete this round. (Never let a 429 read as "no
 *  liquidity": that is exactly the false negative that made a rate-limited
 *  sweep look like missing pools.) */
async function routes(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<RouteSummary | null> {
  const fee = integratorFee();
  const qs = new URLSearchParams({
    tokenIn: sellToken,
    tokenOut: buyToken,
    amountIn: sellAmount.toString(),
  });
  if (fee) {
    qs.set("feeAmount", fee.feeAmount);
    qs.set("chargeFeeBy", "currency_out");
    qs.set("isInBps", "true");
    qs.set("feeReceiver", fee.feeReceiver);
  }
  try {
    const res = await fetch(`${BASE}/routes?${qs}`, {
      headers: { "x-client-id": CLIENT_ID },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) {
      console.error("[kyber] rate limited — client id not whitelisted?");
      return null;
    }
    if (!res.ok) {
      console.error("[kyber] routes http error", { status: res.status, tokenIn: sellToken, tokenOut: buyToken });
      return null;
    }
    const json = (await res.json()) as { code?: number; message?: string; data?: { routeSummary?: RouteSummary } };
    if (json.code !== 0 || !json.data?.routeSummary) {
      // code 4008 = genuinely no route; anything else is worth seeing.
      console.error("[kyber] routes no quote", { code: json.code, message: json.message, tokenOut: buyToken });
      return null;
    }
    return json.data.routeSummary;
  } catch (err) {
    // Timeouts land here. Silent nulls made a venue that never competes look
    // identical to a venue that competed and lost — never let that happen again.
    console.error("[kyber] routes threw", { tokenOut: buyToken, err: String(err) });
    return null;
  }
}

/** Indicative NET price (our fee already deducted by Kyber) — comparable
 *  directly against uniV4Price/lifiPrice/rialtoPrice. */
export async function kyberPrice(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<bigint | null> {
  const summary = await routes(sellToken, buyToken, sellAmount);
  if (!summary) return null;
  try {
    const out = BigInt(summary.amountOut);
    return out > BigInt(0) ? out : null;
  } catch {
    return null;
  }
}

/** POST /route/build response payload. */
interface BuiltRoute {
  data?: string;
  routerAddress?: string;
  amountOut?: string;
  transactionValue?: string;
}

export interface KyberQuote {
  /** Expected NET output to the user. */
  buyAmount: bigint;
  minBuyAmount: bigint;
  /** Run by the smart account after it pulls `sellAmount` of the sell token. */
  steps: { to: Address; data: `0x${string}`; value: string }[];
}

/**
 * Firm quote + the post-pull call sequence.
 * @param executor the smart account that holds the sell token and executes
 * @param taker    the user's EOA, which receives the bought token
 */
export async function kyberQuote(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  executor: Address,
  taker: Address,
): Promise<KyberQuote | null> {
  const summary = await routes(sellToken, buyToken, sellAmount);
  if (!summary) return null;

  let built: BuiltRoute | null = null;
  try {
    const res = await fetch(`${BASE}/route/build`, {
      method: "POST",
      headers: { "x-client-id": CLIENT_ID, "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        routeSummary: summary,
        sender: executor,
        recipient: taker,
        slippageTolerance: SLIPPAGE_BPS,
        deadline: Math.floor(Date.now() / 1000) + 1200,
        source: CLIENT_ID,
      }),
    });
    if (!res.ok) {
      console.error("[kyber] build http error", { status: res.status, tokenOut: buyToken });
      return null;
    }
    const json = (await res.json()) as { code?: number; message?: string; data?: BuiltRoute };
    if (json.code !== 0 || !json.data) {
      console.error("[kyber] build rejected", { code: json.code, message: json.message, tokenOut: buyToken });
      return null;
    }
    built = json.data;
  } catch (err) {
    console.error("[kyber] build threw", { tokenOut: buyToken, err: String(err) });
    return null;
  }

  const router = built?.routerAddress;
  const data = built?.data;
  // Calldata must be non-empty, even-length hex — a malformed body should be
  // refused here rather than reverting an already-sponsored UserOp on-chain.
  const validData = typeof data === "string" && /^0x([0-9a-fA-F]{2})+$/.test(data);
  if (!router || !validData || !/^0x[a-fA-F0-9]{40}$/.test(router)) {
    console.error("[kyber] malformed build payload", { router, dataLen: typeof data === "string" ? data.length : null });
    return null;
  }
  // Every route we build sells an ERC-20 (USDG or a stock), so the call must
  // never carry native value. Anything else means we misread the response.
  if (built?.transactionValue && built.transactionValue !== "0") {
    console.error("[kyber] unexpected native value on an ERC-20 route, refusing", built.transactionValue);
    return null;
  }
  // Refuse anything that isn't the pinned router — this address is both the
  // approval spender and the call target, so an unpinned value is a drain.
  if (router.toLowerCase() !== ROUTER_4663) {
    console.error("[kyber] router address off-pin, refusing quote", { got: router, expected: ROUTER_4663 });
    return null;
  }

  let buyAmount: bigint;
  try {
    buyAmount = BigInt(built?.amountOut ?? summary.amountOut);
  } catch {
    return null;
  }
  if (buyAmount <= BigInt(0)) return null;

  // /route/build returns no minAmountOut — the bound is baked into the calldata
  // from the SAME `SLIPPAGE_BPS` we posted above, so this mirrors the floor the
  // router will actually enforce. Both uses must stay on that one constant: if
  // they ever diverge the UI would promise a floor the router doesn't hold.
  const minBuyAmount = (buyAmount * (BPS - BigInt(SLIPPAGE_BPS))) / BPS;

  return {
    buyAmount,
    minBuyAmount,
    steps: [
      {
        to: sellToken,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [router as Address, sellAmount] }),
        value: "0",
      },
      { to: router as Address, data: data as `0x${string}`, value: "0" },
    ],
  };
}
