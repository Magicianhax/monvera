// OKX x402 pay-per-call gate, built on @okxweb3/app-x402-core (the APP/Broker
// SDK: 402 + PAYMENT-REQUIRED header emission, EIP-3009 verify, Broker settle
// on X Layer) + the exact-EVM server scheme from @okxweb3/x402-evm.
//
// This module owns: the route/price table (routesFor), the canonical accepts
// entry (challengeEntryFor — discovery renders THE SAME object the live 402
// carries, tested for equality), rich agent-readable 402 bodies (decoded
// challenge + full signing contract), and settle-failure classification.
// The settled-payment ledger lives in payments.ts.
import { x402ResourceServer, x402HTTPResourceServer } from "@okxweb3/app-x402-core/server";
import { OKXFacilitatorClient } from "@okxweb3/app-x402-core/facilitator";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { Env } from "./env";
import { PARAM_SPECS } from "./precheck";
import { BASE_URL, DOCS_URL, LLMS_URL, PREREQUISITES } from "./respond";

export const XLAYER_NETWORK = "eip155:196" as const;
export const USDT0_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const CHALLENGE_TTL_SECONDS = 300;

/** Per-call prices in USD. The scheme's default parser converts to USDT0 6dp. */
export const PRICES = {
  plan: 0.5,
  research: 0.25,
  halalScreen: 0.25,
  basket: 0.35,
  build: 0.25,
  backtest: 0.25,
  screener: 0.25,
  compare: 0.3,
  rebalance: 0.35,
} as const;

/** Route path -> price key. Wildcard basket handled explicitly. */
export const PAID_ROUTES: Record<string, keyof typeof PRICES> = {
  "/v1/plan": "plan",
  "/v1/research": "research",
  "/v1/halal-screen": "halalScreen",
  "/v1/basket": "basket",
  "/v1/build": "build",
  "/v1/backtest": "backtest",
  "/v1/screener": "screener",
  "/v1/compare": "compare",
  "/v1/rebalance": "rebalance",
};

const ROUTE_DESCRIPTIONS: Record<string, string> = {
  "/v1/plan": "AI allocation plan over tokenized xStocks (Solana) with backtest and executable legs",
  "/v1/research": "Research note on one tokenized stock",
  "/v1/halal-screen": "AAOIFI shariah screen of tickers or a portfolio",
  "/v1/basket": "Themed tokenized-stock basket allocation with executable legs",
  "/v1/build": "Executable per-leg swap instructions for an external/edited plan",
  "/v1/backtest": "One-year backtest of any weighted basket vs SPY",
  "/v1/screener": "Momentum screener over the full tokenized-stock universe",
  "/v1/compare": "Head-to-head research note on two tokenized stocks",
  "/v1/rebalance": "Rebalance planner: holdings + target -> minimal diff legs",
};

function toBaseUnits(priceUsd: number): string {
  return String(Math.round(priceUsd * 1_000_000)); // USDT0 = 6dp
}

export interface AcceptsEntry {
  scheme: "exact";
  network: typeof XLAYER_NETWORK;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  decimals: number;
  extra: { name: string; version: string };
  outputSchema?: { input: Record<string, unknown> };
}

/**
 * The canonical accepts entry for a paid route — the SAME object shape the live
 * 402 challenge advertises. Discovery (openapi.json, .well-known/x402.json)
 * renders from this function so it structurally cannot drift from the gate.
 */
export function challengeEntryFor(path: string, payTo: string): AcceptsEntry | null {
  const key = PAID_ROUTES[path];
  if (!key) return null;
  const spec = PARAM_SPECS[path];
  const queryParams: Record<string, unknown> = { type: "object", properties: {}, required: [] as string[] };
  if (spec) {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of spec.fields) {
      if (f.type.includes("object")) continue; // nested bodies are never declared as query params
      props[f.name] = { type: f.type.startsWith("number") ? "number" : "string", description: f.description };
      if (f.required) required.push(f.name);
    }
    queryParams.properties = props;
    queryParams.required = required;
    if (spec.requiredAnyOf) (queryParams as { anyOf?: unknown }).anyOf = spec.requiredAnyOf.map((set) => ({ required: set }));
  }
  return {
    scheme: "exact",
    network: XLAYER_NETWORK,
    amount: toBaseUnits(PRICES[key]),
    asset: USDT0_XLAYER,
    payTo,
    maxTimeoutSeconds: CHALLENGE_TTL_SECONDS,
    decimals: 6,
    // extra is signature-critical (EIP-712 domain name/version) — never change
    extra: { name: "USD₮0", version: "1" },
    // Params are declared under queryParams ONLY: the query string is the one
    // carrier every buyer transport preserves (onchainos drops POST bodies).
    outputSchema: { input: { type: "http", method: "POST", queryParams } },
  };
}

export function routesFor(payTo: string): Record<string, unknown> {
  const paid = (path: string, priceKey: keyof typeof PRICES) => ({
    accepts: {
      scheme: "exact",
      payTo,
      price: `$${PRICES[priceKey]}`,
      network: XLAYER_NETWORK,
      maxTimeoutSeconds: CHALLENGE_TTL_SECONDS,
    },
    description: `${ROUTE_DESCRIPTIONS[path]} · Docs: ${LLMS_URL}`,
    mimeType: "application/json",
  });
  const routes: Record<string, unknown> = {};
  for (const [path, key] of Object.entries(PAID_ROUTES)) {
    routes[`POST ${path}`] = paid(path, key);
  }
  routes["POST /v1/basket/*"] = paid("/v1/basket", "basket");
  return routes;
}

/** The full signing contract: everything a cold curl agent needs to pay.
 *  ENVELOPE SHAPE IS LOAD-BEARING: the server parses
 *  {x402Version, accepted, payload, resource} — `accepted` must be the
 *  accepts[0] entry EXACTLY as received from the PAYMENT-REQUIRED header
 *  (verbatim, unmodified; extra or missing keys break requirement matching). */
export function signingContract(amount: string, payTo: string): Record<string, unknown> {
  return {
    eip712Domain: { name: "USD₮0", version: "1", chainId: 196, verifyingContract: USDT0_XLAYER },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    derivation: {
      from: "your paying address",
      to: `payTo from accepts[0]: ${payTo}`,
      value: `accepts[0].amount in base units (6 decimals): ${amount}`,
      validAfter: "0",
      validBefore: `now (unix seconds) + ${CHALLENGE_TTL_SECONDS}`,
      nonce: "32 random bytes as 0x-hex — NEVER reuse a nonce",
    },
    envelope:
      "PAYMENT-SIGNATURE: base64(JSON { x402Version: 2, accepted: <accepts[0] copied VERBATIM from the PAYMENT-REQUIRED challenge — do not add, remove or reorder keys>, payload: { authorization: { from, to, value, validAfter, validBefore, nonce }, signature: '0x...' }, resource: <resource object from the challenge> })",
    template:
      'PAYMENT-SIGNATURE: base64(JSON {"x402Version":2,"accepted":{"scheme":"exact","network":"eip155:196","amount":"' +
      amount +
      '","asset":"' +
      USDT0_XLAYER +
      '","payTo":"' +
      payTo +
      '","maxTimeoutSeconds":300,"extra":{"name":"USD₮0","version":"1"}},"payload":{"authorization":{"from":"0x...","to":"' +
      payTo +
      '","value":"' +
      amount +
      '","validAfter":"0","validBefore":"<unix>","nonce":"0x<32 bytes>"},"signature":"0x..."},"resource":{"url":"<the URL you probed>"}})',
  };
}

// ── SDK server (one initialized instance per isolate) ────────────────────────
type RegisterArg = Parameters<x402ResourceServer["register"]>[1];
type ProcessResult = Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
type ResponseInstructions = Extract<ProcessResult, { type: "payment-error" }>["response"];

let cached: Promise<x402HTTPResourceServer> | null = null;
function getServer(env: Env): Promise<x402HTTPResourceServer> {
  if (!cached) {
    cached = (async () => {
      const facilitator = new OKXFacilitatorClient({
        apiKey: env.OKX_API_KEY,
        secretKey: env.OKX_SECRET_KEY,
        passphrase: env.OKX_PASSPHRASE,
        syncSettle: true,
      });
      const core = new x402ResourceServer(facilitator);
      core.register(XLAYER_NETWORK, new ExactEvmScheme() as unknown as RegisterArg);
      const http = new x402HTTPResourceServer(core, routesFor(env.PAY_TO_ADDRESS) as never);
      await http.initialize();
      return http;
    })();
    cached.catch(() => {
      cached = null; // a failed init (facilitator hiccup) must not poison the isolate
    });
  }
  return cached;
}

/** Test hook: drop the per-isolate server so a new env takes effect. */
export function resetX402ServerForTests(): void {
  cached = null;
}

function adapterFor(request: Request, url: URL) {
  return {
    getHeader: (name: string) => request.headers.get(name) ?? undefined,
    // Paid routes are POST in the SDK route table; buyers may probe with any
    // method (Decision 9) — normalize so the table always matches.
    getMethod: () => "POST",
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getHeaders: () => Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v])),
  };
}

/** Decode base64 JSON with proper UTF-8 handling (atob alone mangles "USD₮0"). */
export function decodeBase64Json(b64: string): unknown {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Enrich the SDK's bare 402 with the full agent-readable body.
 *
 *  HARD RULE learned from a real buyer failure: the PAYMENT-REQUIRED header is
 *  NEVER modified. Buyer clients copy accepts[0] verbatim into their signed
 *  envelope and the SDK deep-matches it against the route table — any injected
 *  key (even informational) breaks "No matching payment requirements".
 *  All enrichment (params schema, signing contract, prerequisites) lives in
 *  the BODY only, which is informational and never round-tripped. */
function enrichChallenge(instructions: ResponseInstructions, path: string, env: Env, missing: string[]): Response {
  const headers: Record<string, string> = { ...instructions.headers, "content-type": "application/json" };
  const challengeB64 = instructions.headers["PAYMENT-REQUIRED"] ?? instructions.headers["payment-required"];
  const entry = challengeEntryFor(path, env.PAY_TO_ADDRESS);
  let decoded: unknown = null;
  try {
    decoded = challengeB64 ? decodeBase64Json(challengeB64) : null;
  } catch {
    decoded = null;
  }
  const spec = PARAM_SPECS[path];
  const body = {
    error: "Payment required",
    code: "PAYMENT_REQUIRED",
    charged: false,
    x402: decoded,
    signing: entry ? signingContract(entry.amount, entry.payTo) : undefined,
    how: [
      "1. This response's PAYMENT-REQUIRED header carries the base64 x402 v2 challenge (decoded under x402 above).",
      "2. Sign an EIP-3009 TransferWithAuthorization for accepts[0] per the signing block.",
      "3. Retry the SAME URL with the PAYMENT-SIGNATURE header; the result returns in that response.",
      `4. Binding rule: the payment binds route path + amount + asset + payTo — NOT the query string. Probing bare and retrying with ?params appended is safe. Challenge expires in ~${CHALLENGE_TTL_SECONDS}s; a late signature needs a fresh probe and a NEW nonce.`,
    ],
    params: spec ? { missing, example: spec.queryExample } : undefined,
    // Informational copy of the param schema (the header stays untouched).
    inputSchema: entry?.outputSchema,
    prerequisites: PREREQUISITES,
    links: { llms: LLMS_URL, openapi: `${BASE_URL}/openapi.json`, wellKnown: `${BASE_URL}/.well-known/x402.json`, docs: DOCS_URL },
  };
  return new Response(JSON.stringify(body), { status: instructions.status, headers });
}

function toResponse(instructions: ResponseInstructions): Response {
  const { status, headers, body, isHtml } = instructions;
  return new Response(isHtml ? String(body ?? "") : JSON.stringify(body ?? {}), {
    status,
    headers: { ...headers, "content-type": isHtml ? "text/html" : "application/json" },
  });
}

function payerFrom(payload: Record<string, unknown>): string {
  const auth = payload["authorization"];
  if (auth && typeof auth === "object" && "from" in auth && typeof auth.from === "string") {
    return auth.from;
  }
  return "unknown";
}

export type SettleOutcome =
  | { kind: "challenge"; response: Response }
  | { kind: "paid"; payer: string; paymentId: string; responseHeaders: Record<string, string> }
  | { kind: "settle-failed"; response: Response; nonceUsed: boolean };

/**
 * Run the SDK verify + settle for a request that carries a payment header, or
 * emit the (enriched) challenge when it does not. The redelivery ledger in
 * payments.ts wraps this. `missingParams` feeds the 402 body's params advisory.
 */
export async function verifyAndSettle(request: Request, env: Env, missingParams: string[] = []): Promise<SettleOutcome> {
  const url = new URL(request.url);
  const path = url.pathname.startsWith("/v1/basket/") ? "/v1/basket" : url.pathname.replace(/\/+$/, "");
  const server = await getServer(env);
  const context = { adapter: adapterFor(request, url), path: url.pathname, method: "POST" };

  // A malformed payment envelope must NEVER 500: classify it as the buyer's
  // input, tell them the exact accepted shape, and confirm nothing was charged.
  let result: ProcessResult;
  try {
    result = await server.processHTTPRequest(context);
  } catch (err) {
    console.error("payment envelope processing failed", err);
    return {
      kind: "settle-failed",
      nonceUsed: false,
      response: new Response(
        JSON.stringify({
          error:
            "Could not parse or match your PAYMENT-SIGNATURE envelope. Nothing was charged; your authorization was not consumed.",
          code: "INVALID_PAYMENT",
          charged: false,
          retryable: true,
          hint: "The envelope must be base64(JSON { x402Version: 2, accepted: <accepts[0] copied VERBATIM from the PAYMENT-REQUIRED challenge>, payload: { authorization, signature }, resource }). Re-probe this URL for the challenge and its signing block, then sign again.",
          docs: LLMS_URL,
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      ),
    };
  }

  if (result.type === "no-payment-required") {
    return { kind: "paid", payer: "unknown", paymentId: "", responseHeaders: {} };
  }
  if (result.type === "payment-error") {
    if (result.response.status === 402) {
      return { kind: "challenge", response: enrichChallenge(result.response, path, env, missingParams) };
    }
    return { kind: "settle-failed", response: toResponse(result.response), nonceUsed: false };
  }
  if (result.type === "payment-verified") {
    let settle: Awaited<ReturnType<typeof server.processSettlement>>;
    try {
      settle = await server.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions);
    } catch (err) {
      console.error("settlement threw", err);
      return {
        kind: "settle-failed",
        nonceUsed: false,
        response: new Response(
          JSON.stringify({
            error: "Settlement processing failed before completion. Nothing was delivered.",
            code: "SETTLE_ERROR",
            charged: false,
            retryable: true,
            hint: "Re-probe this URL for a fresh challenge and sign again with a NEW nonce. If your wallet shows a completed transfer anyway, retry this exact request with the SAME PAYMENT-SIGNATURE — redelivery is free.",
            docs: LLMS_URL,
          }),
          { status: 402, headers: { "content-type": "application/json" } }
        ),
      };
    }
    if (!settle.success) {
      const reason = `${(settle as { errorReason?: string }).errorReason ?? ""} ${(settle as { errorMessage?: string }).errorMessage ?? ""}`.toLowerCase();
      const nonceUsed = /nonce|already|replay|used/.test(reason);
      const expired = /expire|validbefore|timeout|deadline|time window|too late/.test(reason);
      if (expired) {
        return {
          kind: "settle-failed",
          nonceUsed: false,
          response: new Response(
            JSON.stringify({
              error: "The 402 challenge expired (~300 s window). Nothing was delivered.",
              code: "CHALLENGE_EXPIRED",
              charged: false,
              retryable: true,
              hint: "Re-probe this URL without PAYMENT-SIGNATURE for a fresh PAYMENT-REQUIRED challenge and sign again with a NEW nonce.",
              docs: LLMS_URL,
            }),
            { status: 402, headers: { "content-type": "application/json" } }
          ),
        };
      }
      return { kind: "settle-failed", response: toResponse(settle.response), nonceUsed };
    }
    return {
      kind: "paid",
      payer: payerFrom(result.paymentPayload.payload),
      paymentId: (settle as { transaction?: string }).transaction ?? settle.headers["payment-id"] ?? "",
      responseHeaders: settle.headers,
    };
  }
  if (result.type === "payment-presettle") {
    const settled = await result.settle();
    if (!settled.success) {
      return {
        kind: "settle-failed",
        nonceUsed: false,
        response: new Response(JSON.stringify({ error: settled.error ?? "settlement failed", charged: false }), {
          status: 402,
          headers: { "content-type": "application/json", ...(settled.headers ?? {}) },
        }),
      };
    }
    return { kind: "paid", payer: payerFrom(result.paymentPayload.payload), paymentId: "", responseHeaders: settled.headers ?? {} };
  }
  // access-verified (subscription) — we sell pay-per-call only; treat as paid.
  return { kind: "paid", payer: "unknown", paymentId: "", responseHeaders: result.headers ?? {} };
}
