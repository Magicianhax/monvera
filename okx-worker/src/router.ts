import type { Env } from "./env";
import { json, errorJson, requestInput, BASE_URL } from "./respond";
import { PRICES, PAID_ROUTES } from "./x402";
import { gatePayment, chargedFailure } from "./payments";
import { prevalidate, normalizeForRoute, PARAM_SPECS } from "./precheck";
import { BASKETS } from "./baskets";
import { UNIVERSE } from "./universe";

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

/** Inject paymentId into a successful JSON body (agents cite it for support). */
async function withPaymentId(response: Response, paymentId: string): Promise<{ response: Response; bodyText: string }> {
  const text = await response.text();
  let bodyText = text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (paymentId && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed.paymentId = paymentId;
      bodyText = JSON.stringify(parsed);
    }
  } catch {
    /* non-JSON body: pass through untouched */
  }
  return {
    response: new Response(bodyText, { status: response.status, headers: response.headers }),
    bodyText,
  };
}

function missingRequired(path: string, input: Record<string, unknown>): string[] {
  const spec = PARAM_SPECS[path];
  if (!spec) return [];
  return spec.fields.filter((f) => f.required && input[f.name] === undefined).map((f) => f.name);
}

async function dispatchPaid(
  p: string,
  basketIdFromPath: string | null,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  payer: string
): Promise<Response> {
  if (p === "/v1/plan") {
    const { handlePlan } = await import("./handlers/plan");
    return handlePlan(request, env, ctx, payer);
  }
  if (p === "/v1/research") {
    const { handleResearch } = await import("./handlers/research");
    return handleResearch(request, env);
  }
  if (p === "/v1/halal-screen") {
    const { handleHalalScreen } = await import("./handlers/halalScreen");
    return handleHalalScreen(request);
  }
  if (p === "/v1/build") {
    const { handleBuild } = await import("./handlers/build");
    return handleBuild(request, env);
  }
  if (p === "/v1/backtest") {
    const { handleBacktest } = await import("./handlers/backtest");
    return handleBacktest(request);
  }
  if (p === "/v1/screener") {
    const { handleScreener } = await import("./handlers/screener");
    return handleScreener();
  }
  if (p === "/v1/compare") {
    const { handleCompare } = await import("./handlers/compare");
    return handleCompare(request, env);
  }
  if (p === "/v1/rebalance") {
    const { handleRebalance } = await import("./handlers/rebalance");
    return handleRebalance(request);
  }
  const { handleBasket } = await import("./handlers/basket");
  return handleBasket(request, env, ctx, basketIdFromPath ?? "", payer);
}

export async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";

  // ── free routes ────────────────────────────────────────────────────────────
  if (request.method === "GET" && p === "/") {
    const { catalog } = await import("./discovery");
    return json(catalog(env));
  }

  if (request.method === "GET" && (p === "/llms.txt" || p === "/llms-full.txt")) {
    const { llmsTxt, llmsFullTxt } = await import("./discovery");
    return new Response(p === "/llms.txt" ? llmsTxt(env) : llmsFullTxt(env), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  if (request.method === "GET" && p === "/openapi.json") {
    const { openapi } = await import("./discovery");
    return json(openapi(env));
  }

  if (request.method === "GET" && (p === "/.well-known/x402.json" || p === "/.well-known/x402")) {
    const { wellKnownX402 } = await import("./discovery");
    return json(wellKnownX402(env));
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
    const input = await requestInput(request);
    if (typeof input.symbol !== "string") {
      return errorJson(400, 'missing required query param "symbol".', {
        code: "MISSING_PARAM",
        inputRequired: true,
        hint: `GET ${BASE_URL}/v1/quote/AAPLx — or POST ${BASE_URL}/v1/quote?symbol=AAPLx`,
      });
    }
    const { handleQuote } = await import("./handlers/quote");
    return handleQuote(input.symbol, env, ctx);
  }

  if (request.method === "GET" && p === "/v1/preflight") {
    const { handlePreflight } = await import("./handlers/preflight");
    return handlePreflight(request, env, ctx);
  }

  if (request.method === "GET" && p.startsWith("/v1/record/")) {
    const { handleRecordStatus } = await import("./handlers/recordStatus");
    return handleRecordStatus(decodeURIComponent(p.slice("/v1/record/".length)), env);
  }

  if (request.method === "POST" && p === "/v1/build/stage") {
    const { handleBuildStage } = await import("./handlers/buildStage");
    return handleBuildStage(request, env, ctx);
  }

  // ── paid routes ────────────────────────────────────────────────────────────
  const basketMatch = /^\/v1\/basket\/([a-z-]+)$/.exec(p);
  const routePath = basketMatch ? "/v1/basket" : p;
  const isPaidPath = routePath in PAID_ROUTES;
  if (!isPaidPath) {
    return errorJson(404, "Not found. GET / lists all services.", { code: "NOT_FOUND", hint: `GET ${BASE_URL}/` });
  }

  const { paymentHeaderOf } = await import("./payments");
  const signed = paymentHeaderOf(request) !== null;

  // Method matrix: an UNSIGNED request cannot be charged, so it ALWAYS gets the
  // 402 challenge (OKX buyer tooling probes bare endpoints — any method — and
  // treats anything but 402/200 as unreachable; the challenge itself teaches
  // the params via accepts[].outputSchema and the body's params advisory).
  // A SIGNED request is about to move money: validate BEFORE the payment gate —
  // a request that would fail must never charge ("Nothing was charged").
  const input = normalizeForRoute(routePath, await requestInput(request.clone() as unknown as Request));

  if (signed) {
    const problem = await prevalidate(routePath, basketMatch?.[1] ?? null, input, env);
    if (problem) return errorJson(problem.status, problem.message, problem.extras);
  }

  const pay = await gatePayment(request, env, ctx, routePath, missingRequired(routePath, input));
  if (pay.kind === "unpaid") return pay.response;
  if (pay.kind === "replay") return pay.cached;

  try {
    const raw = await dispatchPaid(routePath, basketMatch?.[1] ?? null, request, env, ctx, pay.payer);
    if (raw.status >= 400) {
      // Post-settlement failure: the buyer paid. The ledger entry stays at
      // "settled", so the identical replay regenerates the product free.
      const detail = await raw
        .clone()
        .json()
        .then((b) => (b as { error?: string }).error ?? `HTTP ${raw.status}`)
        .catch(() => `HTTP ${raw.status}`);
      return chargedFailure(pay.paymentId, String(detail));
    }
    const { response, bodyText } = await withPaymentId(raw, pay.paymentId);
    pay.markDelivered(bodyText);
    return withHeaders(response, pay.responseHeaders);
  } catch (err) {
    console.error("paid dispatch failed", routePath, err);
    return chargedFailure(pay.paymentId, err instanceof Error ? err.message : "engine error");
  }
}
