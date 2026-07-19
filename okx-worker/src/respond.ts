export const BASE_URL = "https://vera.monvera.best";
export const DOCS_URL = "https://docs.monvera.best/dev/vera-on-okx-ai/";
export const LLMS_URL = `${BASE_URL}/llms.txt`;

export const DISCLAIMER =
  "Research output over tokenized xStocks. Not investment advice. Execute only through your own wallet.";
export const BACKTEST_DISCLAIMER = "Backtests are history, not promises.";

/** Funding prerequisites — the two-chain reality every buyer must know BEFORE paying. */
export const PREREQUISITES = {
  payment: {
    asset: "USDT0",
    address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    network: "eip155:196 (X Layer)",
    gasless: true,
  },
  execution: {
    asset: "USDC",
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    network: "Solana (chainIndex 501)",
    alsoNeeds: "SOL for tx fees",
    custody: "Your wallet executes; Vera never holds funds.",
    preflight: "GET /v1/preflight?wallet=<addr>&amountUsd=<usd>",
  },
} as const;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, payment-id, X-Idempotent-Replay",
};

/** Apply CORS to any outgoing response (idempotent). */
export function withCors(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
  return out;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export interface ErrorExtras {
  code?: string;
  charged?: boolean;
  retryable?: boolean;
  hint?: string;
  inputRequired?: boolean;
  fields?: Array<{ name: string; type: string; required?: boolean; description: string }>;
  requiredAnyOf?: string[][] | null;
  paymentId?: string;
  retryAfterSeconds?: number;
  docs?: string;
}

/**
 * Error body for agents: `error` stays the first key (OKX parsers key on the
 * flat shape); every field after it is machine-actionable next-step data.
 */
export function errorJson(status: number, message: string, extras: ErrorExtras = {}): Response {
  return json(
    {
      error: message,
      ...(extras.code !== undefined && { code: extras.code }),
      charged: extras.charged ?? false,
      ...(extras.retryable !== undefined && { retryable: extras.retryable }),
      ...(extras.inputRequired !== undefined && { inputRequired: extras.inputRequired }),
      ...(extras.fields !== undefined && { fields: extras.fields }),
      ...(extras.requiredAnyOf !== undefined && { requiredAnyOf: extras.requiredAnyOf }),
      ...(extras.hint !== undefined && { hint: extras.hint }),
      ...(extras.paymentId !== undefined && { paymentId: extras.paymentId }),
      ...(extras.retryAfterSeconds !== undefined && { retryAfterSeconds: extras.retryAfterSeconds }),
      docs: extras.docs ?? LLMS_URL,
    },
    { status }
  );
}

/**
 * Merged request input: URL query params with the JSON body layered on top.
 * A2MCP callers vary in where they put business params; accept both everywhere.
 */
export async function requestInput(request: Request): Promise<Record<string, unknown>> {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  return { ...query, ...(body ?? {}) };
}
