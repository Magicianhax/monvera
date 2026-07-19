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
        { path: "GET /v1/quote/:symbol", priceUsd: 0, what: "Live quote + liquidity snapshot for one xStock" },
        { path: "POST /v1/plan", priceUsd: PRICES.plan, what: "Goal + budget + risk -> weighted allocation with rationale and 1Y backtest", body: { goal: "string", amountUsd: "number", riskTolerance: "conservative|balanced|aggressive (optional)" } },
        { path: "POST /v1/research", priceUsd: PRICES.research, what: "Research note on one tokenized stock", body: { symbol: "string" } },
        { path: "POST /v1/halal-screen", priceUsd: PRICES.halalScreen, what: "AAOIFI shariah screen with reasons", body: { symbols: ["string"] } },
        { path: "POST /v1/basket/:id", priceUsd: PRICES.basket, what: "Themed basket allocation", baskets: Object.keys(BASKETS), body: { amountUsd: "number" } },
        { path: "POST /v1/build", priceUsd: PRICES.build, what: "Plan -> per-leg OKX DEX swap instructions (you execute)", body: { plan: "Allocation", amountUsd: "number" } },
        { path: "POST /v1/backtest", priceUsd: PRICES.backtest, what: "1-year backtest of any weighted basket vs SPY", body: { allocations: [{ symbol: "string", weightPct: "number" }] } },
        { path: "POST /v1/screener", priceUsd: PRICES.screener, what: "Momentum screener over the full universe", body: {} },
        { path: "POST /v1/compare", priceUsd: PRICES.compare, what: "Head-to-head note on two stocks", body: { symbolA: "string", symbolB: "string", goal: "string (optional)" } },
        { path: "POST /v1/rebalance", priceUsd: PRICES.rebalance, what: "Holdings + target -> minimal diff legs", body: { holdings: [{ symbol: "string", usdValue: "number" }], target: [{ symbol: "string", weightPct: "number" }], cashUsd: "number (optional)" } },
      ],
      trust:
        "Every paid plan is committed on-chain (X Layer) with a signature binding the payer, spend and legs. Track record is publicly auditable.",
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
  if (basketMatch && request.method === "POST" && !(basketMatch[1] in BASKETS)) {
    // Reject BEFORE the payment gate — never charge for a guaranteed 404.
    return errorJson(404, `Unknown basket: ${basketMatch[1]}. Available: ${Object.keys(BASKETS).join(", ")}.`);
  }
  if (p === "/v1/basket" && request.method === "POST") {
    // Body-form basket: peek the id before the payment gate for the same reason.
    const peek = (await request.clone().json().catch(() => null)) as { basket?: unknown } | null;
    if (typeof peek?.basket !== "string" || !(peek.basket in BASKETS)) {
      return errorJson(404, `Unknown basket: ${typeof peek?.basket === "string" ? peek.basket : "(none given)"}. Available: ${Object.keys(BASKETS).join(", ")}.`);
    }
  }
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
