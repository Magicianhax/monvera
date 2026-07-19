// Free: stage an external plan JSON, get a query-string-safe planId.
// Content-addressed (idempotent): planId = "ext-" + sha256(canonical JSON).
import type { Env } from "../env";
import { json, errorJson, BASE_URL } from "../respond";
import { AllocationSchema } from "../allocation-schema";
import { assetBySymbol } from "../universe";
import { PRICES } from "../x402";
import { rateLimit } from "./rateLimit";

const MAX_BODY_BYTES = 8 * 1024;
const TTL_S = 24 * 60 * 60;

export async function handleBuildStage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const limited = await rateLimit(request, env, ctx, "stage");
  if (limited) return limited;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return errorJson(413, `Body over ${MAX_BODY_BYTES / 1024} KB.`, { code: "INVALID_PARAM" });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return errorJson(400, "Body must be an Allocation JSON: { summary?, rationale?, riskScore?, allocations: [{ symbol, weightPct }] }.");
  }
  // Accept either the bare Allocation or { plan: Allocation }
  const candidate = (raw as { plan?: unknown }).plan ?? raw;
  const parsed = AllocationSchema.safeParse({
    summary: "external",
    rationale: "external",
    riskScore: 5000,
    ...(candidate as Record<string, unknown>),
  });
  if (!parsed.success) {
    return errorJson(400, `Invalid plan: ${parsed.error.issues[0]?.message ?? "schema mismatch"}.`);
  }
  const unknown = parsed.data.allocations.filter((a) => assetBySymbol(a.symbol) === undefined);
  if (unknown.length > 0) {
    return errorJson(400, `Unknown symbols: ${unknown.map((a) => a.symbol).join(", ")}. GET /v1/universe lists all names.`, {
      code: "UNKNOWN_SYMBOL",
    });
  }

  const canonical = JSON.stringify(parsed.data);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const planId = "ext-" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Synchronous write: the very next call may reference this id.
  await env.KV.put(
    `plan:${planId}`,
    JSON.stringify({ v: 1, source: "external", plan: parsed.data, createdAt: Date.now() }),
    { expirationTtl: TTL_S }
  );

  return json({
    planId,
    expiresAt: new Date(Date.now() + TTL_S * 1000).toISOString(),
    idempotent: "Staging the same plan again returns the same planId.",
    next: {
      method: "POST",
      url: `${BASE_URL}/v1/build?planId=${planId}&amountUsd=<usd>`,
      priceUsd: PRICES.build,
    },
  });
}
