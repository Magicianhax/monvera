// OKX x402 pay-per-call gate, built on @okxweb3/app-x402-core (the APP/Broker
// SDK: 402 + PAYMENT-REQUIRED header emission, EIP-3009 verify, Broker settle
// on X Layer) + the exact-EVM server scheme from @okxweb3/x402-evm (its default
// asset table maps eip155:196 → USDT0 6dp, matching the howtomcp doc).
//
// Flow per paid route: no payment header → 402 challenge; payment header →
// facilitator verify, then SYNCHRONOUS settle (charge-then-deliver, syncSettle)
// before the handler runs. Settlement response headers are attached to the
// final response so the buyer's client can cite the paymentId.
import { x402ResourceServer, x402HTTPResourceServer } from "@okxweb3/app-x402-core/server";
import { OKXFacilitatorClient } from "@okxweb3/app-x402-core/facilitator";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { Env } from "./env";

export const XLAYER_NETWORK = "eip155:196" as const;
export const USDT0_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

/** Per-call prices in USD. The scheme's default parser converts to USDT0 6dp. */
export const PRICES = {
  plan: 0.5,
  research: 0.25,
  halalScreen: 0.25,
  basket: 0.35,
  build: 0.25,
} as const;

type RegisterArg = Parameters<x402ResourceServer["register"]>[1];
type RoutesConfig = ConstructorParameters<typeof x402HTTPResourceServer>[1];
type ProcessResult = Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
type ResponseInstructions = Extract<ProcessResult, { type: "payment-error" }>["response"];

function routesFor(payTo: string): RoutesConfig {
  const paid = (price: number, description: string) => ({
    accepts: {
      scheme: "exact",
      payTo,
      price: `$${price}`,
      network: XLAYER_NETWORK,
      maxTimeoutSeconds: 300,
    },
    description,
    mimeType: "application/json",
  });
  return {
    "POST /v1/plan": paid(PRICES.plan, "AI allocation plan over tokenized xStocks (Solana)"),
    "POST /v1/research": paid(PRICES.research, "Research note on one tokenized stock"),
    "POST /v1/halal-screen": paid(PRICES.halalScreen, "AAOIFI shariah screen of tickers or a portfolio"),
    "POST /v1/basket": paid(PRICES.basket, "Themed tokenized-stock basket allocation"),
    "POST /v1/basket/*": paid(PRICES.basket, "Themed tokenized-stock basket allocation"),
    "POST /v1/build": paid(PRICES.build, "Executable per-leg swap instructions for a plan"),
  };
}

// One initialized server per isolate (initialize() fetches facilitator support).
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
      // The exact-EVM server scheme is typed against the sibling x402-core
      // package; the SchemeNetworkServer surface is structurally identical.
      core.register(XLAYER_NETWORK, new ExactEvmScheme() as unknown as RegisterArg);
      const http = new x402HTTPResourceServer(core, routesFor(env.PAY_TO_ADDRESS));
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
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getHeaders: () => Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v])),
  };
}

function toResponse(instructions: ResponseInstructions): Response {
  const { status, headers, body, isHtml } = instructions;
  return new Response(isHtml ? String(body ?? "") : JSON.stringify(body ?? {}), {
    status,
    headers: { "content-type": isHtml ? "text/html" : "application/json", ...headers },
  });
}

function payerFrom(payload: Record<string, unknown>): string {
  const auth = payload["authorization"];
  if (auth && typeof auth === "object" && "from" in auth && typeof auth.from === "string") {
    return auth.from;
  }
  return "unknown";
}

export type PaymentResult =
  | { paid: true; payer: string; paymentId: string; responseHeaders: Record<string, string> }
  | { paid: false; response: Response };

/**
 * Gate a paid route: emit the 402 challenge, or verify + settle the presented
 * payment via the OKX Broker. Free routes (not in the route table) pass through.
 */
export async function requirePayment(request: Request, env: Env): Promise<PaymentResult> {
  const url = new URL(request.url);
  const server = await getServer(env);
  const context = { adapter: adapterFor(request, url), path: url.pathname, method: request.method };

  const result = await server.processHTTPRequest(context);

  if (result.type === "no-payment-required") {
    return { paid: true, payer: "unknown", paymentId: "", responseHeaders: {} };
  }
  if (result.type === "payment-error") {
    return { paid: false, response: toResponse(result.response) };
  }
  if (result.type === "payment-verified") {
    const settle = await server.processSettlement(
      result.paymentPayload,
      result.paymentRequirements,
      result.declaredExtensions
    );
    if (!settle.success) {
      return { paid: false, response: toResponse(settle.response) };
    }
    return {
      paid: true,
      payer: payerFrom(result.paymentPayload.payload),
      paymentId: (settle as { transaction?: string }).transaction ?? settle.headers["payment-id"] ?? "",
      responseHeaders: settle.headers,
    };
  }
  if (result.type === "payment-presettle") {
    const settled = await result.settle();
    if (!settled.success) {
      return {
        paid: false,
        response: new Response(JSON.stringify({ error: settled.error ?? "settlement failed" }), {
          status: 402,
          headers: { "content-type": "application/json", ...(settled.headers ?? {}) },
        }),
      };
    }
    return {
      paid: true,
      payer: payerFrom(result.paymentPayload.payload),
      paymentId: "",
      responseHeaders: settled.headers ?? {},
    };
  }
  // access-verified (subscription) — we sell pay-per-call only; treat as paid.
  return { paid: true, payer: "unknown", paymentId: "", responseHeaders: result.headers ?? {} };
}
