// The settled-but-unredeemed payment ledger (Decision 10).
//
// x402 settles BEFORE the product is generated, so a post-settlement failure
// would otherwise burn the buyer's nonce with nothing to show. The ledger
// records `settled` SYNCHRONOUSLY after settlement succeeds and BEFORE the
// handler runs; a replay carrying the same PAYMENT-SIGNATURE finds the entry,
// skips settlement entirely, and re-runs the handler until a success overwrites
// the entry to `delivered` (with the response body cached 24 h — the buyer's
// re-retrieval right). Failure bodies are NEVER cached.
import type { Env } from "./env";
import { verifyAndSettle, type SettleOutcome } from "./x402";
import { errorJson, DOCS_URL } from "./respond";

const LEDGER_TTL_S = 24 * 60 * 60;

export interface LedgerEntry {
  status: "settled" | "delivered";
  route: string;
  payer: string;
  paymentId: string;
  ts: number;
  body?: string;
  responseHeaders?: Record<string, string>;
}

export async function sigHash(header: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(header));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function paymentHeaderOf(request: Request): string | null {
  return request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readLedger(env: Env, key: string): Promise<LedgerEntry | null> {
  return (await env.KV.get(key, "json").catch(() => null)) as LedgerEntry | null;
}

export type PaymentGate =
  | { kind: "unpaid"; response: Response }
  | { kind: "replay"; cached: Response }
  | {
      kind: "paid";
      payer: string;
      paymentId: string;
      responseHeaders: Record<string, string>;
      /** Persist the successful response body for the 24 h replay right. */
      markDelivered: (body: string) => void;
    };

/**
 * The full payment gate: challenge, ledger replay, or verify+settle+record.
 * On "paid", the caller runs the handler; a handler failure leaves the ledger
 * entry at `settled` so the identical replay regenerates the product free.
 */
export async function gatePayment(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  route: string,
  missingParams: string[] = []
): Promise<PaymentGate> {
  const header = paymentHeaderOf(request);

  if (!header) {
    const outcome = await verifyAndSettle(request, env, missingParams);
    // Without a payment header the only possible outcomes are challenge/failed.
    if (outcome.kind === "paid") {
      // Free pass-through (route not in the paid table) — treat as paid-zero.
      return { kind: "paid", payer: outcome.payer, paymentId: outcome.paymentId, responseHeaders: outcome.responseHeaders, markDelivered: () => undefined };
    }
    return { kind: "unpaid", response: outcome.kind === "challenge" ? outcome.response : outcome.response };
  }

  const key = `pay:${await sigHash(header)}`;
  const entry = await readLedger(env, key);

  if (entry?.status === "delivered" && entry.body) {
    return {
      kind: "replay",
      cached: new Response(entry.body, {
        status: 200,
        headers: { "content-type": "application/json", "X-Idempotent-Replay": "true", ...(entry.responseHeaders ?? {}) },
      }),
    };
  }

  if (entry?.status === "settled") {
    // Payment already settled — skip settlement, just regenerate the product.
    return paidResult(env, ctx, key, entry.route, entry.payer, entry.paymentId, entry.responseHeaders ?? {});
  }

  let outcome: SettleOutcome = await verifyAndSettle(request, env, missingParams);

  if (outcome.kind === "settle-failed" && outcome.nonceUsed) {
    // The nonce was consumed but our ledger has no entry yet — likely KV
    // cross-region propagation. Read-retry before declaring a dead end.
    for (let i = 0; i < 3; i++) {
      await sleep(2000);
      const retry = await readLedger(env, key);
      if (retry?.status === "delivered" && retry.body) {
        return {
          kind: "replay",
          cached: new Response(retry.body, {
            status: 200,
            headers: { "content-type": "application/json", "X-Idempotent-Replay": "true", ...(retry.responseHeaders ?? {}) },
          }),
        };
      }
      if (retry?.status === "settled") {
        return paidResult(env, ctx, key, retry.route, retry.payer, retry.paymentId, retry.responseHeaders ?? {});
      }
    }
    return {
      kind: "unpaid",
      response: errorJson(402, "This authorization was already settled, and no delivery record was found yet.", {
        code: "NONCE_USED",
        retryable: true,
        retryAfterSeconds: 60,
        hint: "If you were charged, retry the identical request with the SAME PAYMENT-SIGNATURE (redelivery is free); a just-settled payment can take up to 60 s to become replayable everywhere. Otherwise re-probe for a fresh challenge and sign with a NEW nonce.",
      }),
    };
  }

  if (outcome.kind === "challenge" || outcome.kind === "settle-failed") {
    return { kind: "unpaid", response: outcome.response };
  }

  // Fresh settlement succeeded — record it BEFORE the handler runs (synchronous:
  // this write is what makes the charged-5xx replay promise mechanically true).
  const fresh: LedgerEntry = {
    status: "settled",
    route,
    payer: outcome.payer,
    paymentId: outcome.paymentId,
    ts: Date.now(),
    responseHeaders: outcome.responseHeaders,
  };
  await env.KV.put(key, JSON.stringify(fresh), { expirationTtl: LEDGER_TTL_S });
  return paidResult(env, ctx, key, route, outcome.payer, outcome.paymentId, outcome.responseHeaders);
}

function paidResult(
  env: Env,
  ctx: ExecutionContext,
  key: string,
  route: string,
  payer: string,
  paymentId: string,
  responseHeaders: Record<string, string>
): PaymentGate {
  return {
    kind: "paid",
    payer,
    paymentId,
    responseHeaders,
    markDelivered: (body: string) => {
      const entry: LedgerEntry = { status: "delivered", route, payer, paymentId, ts: Date.now(), body, responseHeaders };
      ctx.waitUntil(env.KV.put(key, JSON.stringify(entry), { expirationTtl: LEDGER_TTL_S }).catch(() => undefined));
    },
  };
}

/** The charged-5xx body: the buyer paid; the retry path must be spelled out. */
export function chargedFailure(paymentId: string, detail: string): Response {
  return errorJson(502, `You WERE charged, and the engine failed after settlement: ${detail}`, {
    code: "UPSTREAM_FAILED",
    charged: true,
    retryable: true,
    paymentId,
    hint: `Retry the identical request with the SAME PAYMENT-SIGNATURE — settlement is skipped (it was recorded before the engine ran) and the result is regenerated free. Still failing after 24 h: quote paymentId ${paymentId || "(none)"} at ${DOCS_URL} for a USDT0 refund within 72 h.`,
  });
}
