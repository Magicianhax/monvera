import type { Env } from "./env";
import { json, errorJson } from "./respond";
import { requirePayment, PRICES } from "./x402";
import { BASKETS } from "./baskets";
import { UNIVERSE } from "./universe";

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";

  // ── free routes ────────────────────────────────────────────────────────────
  if (request.method === "GET" && p === "/") {
    return json({
      name: "Vera — AI Stock Broker",
      description:
        "AI research and allocation plans over real tokenized stocks (xStocks on Solana). Pay per call in USDT0 on X Layer. Non-custodial: your own wallet executes every trade.",
      universe: UNIVERSE.length,
      services: [
        { path: "GET /v1/universe", priceUsd: 0, what: "Full tradable universe: symbol, name, underlying, Solana mint" },
        { path: "GET /v1/quote/:symbol", priceUsd: 0, what: "Live quote + liquidity snapshot for one xStock" },
        { path: "POST /v1/plan", priceUsd: PRICES.plan, what: "Goal + budget + risk -> weighted allocation with rationale, 1Y backtest AND executable legs included", body: { goal: "string", amountUsd: "number", riskTolerance: "conservative|balanced|aggressive (optional)" } },
        { path: "POST /v1/research", priceUsd: PRICES.research, what: "Research note on one tokenized stock", body: { symbol: "string" } },
        { path: "POST /v1/halal-screen", priceUsd: PRICES.halalScreen, what: "AAOIFI shariah screen with reasons", body: { symbols: ["string"] } },
        { path: "POST /v1/basket/:id", priceUsd: PRICES.basket, what: "Themed basket allocation with executable legs included", baskets: Object.keys(BASKETS), body: { amountUsd: "number" } },
        { path: "POST /v1/build", priceUsd: PRICES.build, what: "EXTERNAL/edited plan -> per-leg swap instructions (plan and basket already include legs)", body: { plan: "Allocation", amountUsd: "number" } },
        { path: "POST /v1/backtest", priceUsd: PRICES.backtest, what: "1-year backtest of any weighted basket vs SPY", body: { allocations: [{ symbol: "string", weightPct: "number" }] } },
        { path: "POST /v1/screener", priceUsd: PRICES.screener, what: "Momentum screener over the full universe", body: {} },
        { path: "POST /v1/compare", priceUsd: PRICES.compare, what: "Head-to-head note on two stocks", body: { symbolA: "string", symbolB: "string", goal: "string (optional)" } },
        { path: "POST /v1/rebalance", priceUsd: PRICES.rebalance, what: "Holdings + target -> minimal diff legs", body: { holdings: [{ symbol: "string", usdValue: "number" }], target: [{ symbol: "string", weightPct: "number" }], cashUsd: "number (optional)" } },
      ],
      payment: {
        protocol: "x402 v2",
        how: "Call a paid endpoint without payment and it returns HTTP 402 with the full challenge (base64 JSON) in the PAYMENT-REQUIRED response header. Sign the EIP-3009 authorization for the accepted entry, retry the same request with the PAYMENT-SIGNATURE header, and the result is returned in that response.",
        network: "eip155:196 (X Layer)",
        assets: ["USDT0 0x779ded0c9e1022225f8e0630b35a9b54be713736 (6 decimals)"],
        payTo: env.PAY_TO_ADDRESS,
        scheme: "exact",
        gasless: "EIP-3009 transfer-with-authorization; the buyer pays no gas.",
        okxTooling: "onchainos: `payment quote <url> --method POST` then `payment pay --payment-id <id>` handles this automatically.",
      },
      agent: {
        id: "6711",
        name: "Vera by Monvera",
        marketplace: "okx.ai",
        trackRecordContract: "0xd97cd1a25484252bf234ab384c3818b05e6594e0 (X Layer)",
      },
      docs: "https://docs.monvera.best/dev/vera-on-okx-ai/",
      trust:
        "Every paid plan is committed on-chain (X Layer) with a signature binding the payer, spend and legs. Track record is publicly auditable at the contract above.",
    });
  }

  if (request.method === "GET" && p === "/v1/universe") {
    return json({
      count: UNIVERSE.length,
      note: "Every listed name is verified executable against the OKX DEX aggregator on Solana (names that quote but cannot execute are excluded).",
      baskets: Object.keys(BASKETS),
      assets: UNIVERSE,
    });
  }

  if (request.method === "GET" && p.startsWith("/v1/quote/")) {
    const symbol = decodeURIComponent(p.slice("/v1/quote/".length));
    const { handleQuote } = await import("./handlers/quote");
    return handleQuote(symbol, env, ctx);
  }

  if (request.method === "POST" && p === "/v1/quote") {
    // Free body-form variant (ASP listings need a concrete parameterless URL).
    const body = (await request.json().catch(() => null)) as { symbol?: unknown } | null;
    if (typeof body?.symbol !== "string") return errorJson(400, "Body must be { symbol: string }.");
    const { handleQuote } = await import("./handlers/quote");
    return handleQuote(body.symbol, env, ctx);
  }

  // ── paid routes (the x402 route table decides price; unknown paths fall out) ─
  const basketMatch = /^\/v1\/basket\/([a-z-]+)$/.exec(p);
  const isPaidPath =
    request.method === "POST" &&
    (p === "/v1/plan" ||
      p === "/v1/research" ||
      p === "/v1/halal-screen" ||
      p === "/v1/build" ||
      p === "/v1/basket" ||
      p === "/v1/backtest" ||
      p === "/v1/screener" ||
      p === "/v1/compare" ||
      p === "/v1/rebalance" ||
      basketMatch !== null);

  if (!isPaidPath) return errorJson(404, "Not found. GET / lists all services.");

  // x402 settles BEFORE the merchant validates, so validate first — a request
  // that would fail must be rejected here, before anyone is charged.
  {
    const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
    const input = { ...Object.fromEntries(url.searchParams), ...(body ?? {}) };
    const { prevalidate } = await import("./precheck");
    const problem = prevalidate(basketMatch ? "/v1/basket" : p, basketMatch?.[1] ?? null, input);
    if (problem) return errorJson(400, `${problem} Nothing was charged.`);
  }

  const pay = await requirePayment(request, env);
  if (!pay.paid) return pay.response;

  let response: Response;
  if (p === "/v1/plan") {
    const { handlePlan } = await import("./handlers/plan");
    response = await handlePlan(request, env, ctx, pay.payer);
  } else if (p === "/v1/research") {
    const { handleResearch } = await import("./handlers/research");
    response = await handleResearch(request, env);
  } else if (p === "/v1/halal-screen") {
    const { handleHalalScreen } = await import("./handlers/halalScreen");
    response = await handleHalalScreen(request);
  } else if (p === "/v1/build") {
    const { handleBuild } = await import("./handlers/build");
    response = await handleBuild(request);
  } else if (p === "/v1/backtest") {
    const { handleBacktest } = await import("./handlers/backtest");
    response = await handleBacktest(request);
  } else if (p === "/v1/screener") {
    const { handleScreener } = await import("./handlers/screener");
    response = await handleScreener();
  } else if (p === "/v1/compare") {
    const { handleCompare } = await import("./handlers/compare");
    response = await handleCompare(request, env);
  } else if (p === "/v1/rebalance") {
    const { handleRebalance } = await import("./handlers/rebalance");
    response = await handleRebalance(request);
  } else {
    const { handleBasket } = await import("./handlers/basket");
    const idFromPath = p === "/v1/basket" ? "" : p.split("/").pop()!;
    response = await handleBasket(request, env, ctx, idFromPath, pay.payer);
  }
  return withHeaders(response, pay.responseHeaders);
}
