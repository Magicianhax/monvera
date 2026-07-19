// Pre-payment request validation + the PARAM_SPECS registry.
//
// x402 settles the fee BEFORE the merchant sees the request, so a request that
// would fail must be rejected here, before the payment gate — a buyer must
// never pay for a guaranteed failure ("Nothing was charged" invariant).
//
// PARAM_SPECS is the single human-authored source for parameter documentation:
// 400 fields[], 402 outputSchema.input.queryParams, OpenAPI parameters and
// llms.txt examples all render from it. A fixture-equivalence test in
// test/paramSpecs.test.ts proves it accepts/rejects the same inputs as the zod
// schemas below, so the two cannot drift silently.
import { z } from "zod";
import { AllocateRequestSchema } from "./allocation-schema";
import { assetBySymbol } from "./universe";
import { BASKETS } from "./baskets";
import { BASE_URL, LLMS_URL, type ErrorExtras } from "./respond";
import type { Env } from "./env";

// ── CSV / scalar coercions (query-string transport for array params) ─────────
function csvList(v: unknown): string[] | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function csvPairs(v: unknown): Array<{ sym: string; num: number }> | undefined {
  const parts = csvList(v);
  if (!parts) return undefined;
  const out: Array<{ sym: string; num: number }> = [];
  for (const p of parts) {
    const idx = p.lastIndexOf(":");
    if (idx <= 0) return undefined;
    const num = Number(p.slice(idx + 1));
    if (!Number.isFinite(num)) return undefined;
    out.push({ sym: p.slice(0, idx), num });
  }
  return out;
}

/**
 * Normalize transport-level scalar encodings into the canonical JSON shapes
 * the zod schemas (and handlers) understand. Shared by prevalidate AND the
 * handlers so both sides always see identical input.
 */
export function normalizeForRoute(path: string, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (path === "/v1/halal-screen" && typeof out.symbols === "string") {
    out.symbols = csvList(out.symbols) ?? out.symbols;
  }
  if ((path === "/v1/backtest" || path === "/v1/build") && typeof out.symbols === "string") {
    const symbols = csvList(out.symbols);
    const weights = csvList(typeof out.weights === "string" ? out.weights : undefined)?.map(Number);
    if (symbols && weights && symbols.length === weights.length && weights.every((w) => Number.isFinite(w))) {
      const allocations = symbols.map((s, i) => ({ symbol: s, weightPct: weights[i] }));
      if (path === "/v1/backtest") out.allocations = out.allocations ?? allocations;
      if (path === "/v1/build") out.plan = out.plan ?? { summary: "external", rationale: "external", riskScore: 5000, allocations };
    }
  }
  if (path === "/v1/rebalance") {
    if (typeof out.holdings === "string") {
      const pairs = csvPairs(out.holdings);
      if (pairs) out.holdings = pairs.map((p) => ({ symbol: p.sym, usdValue: p.num }));
    }
    if (typeof out.target === "string") {
      const pairs = csvPairs(out.target);
      if (pairs) out.target = pairs.map((p) => ({ symbol: p.sym, weightPct: p.num }));
    }
  }
  return out;
}

// ── zod schemas (authoritative validation) ───────────────────────────────────
const research = z.object({ symbol: z.string().min(1).max(12) });
const halal = z.object({ symbols: z.array(z.string().min(1).max(12)).min(1).max(50) });
const basket = z.object({
  amountUsd: z.coerce.number().min(1).max(1_000_000),
  basket: z.string().optional(),
});
const PLAN_ID_RE = /^(0x[0-9a-f]{64}|ext-[0-9a-f]{64})$/;
const buildSchema = z.object({
  amountUsd: z.coerce.number().min(1).max(1_000_000),
  planId: z.string().regex(PLAN_ID_RE).optional(),
  plan: z
    .object({
      allocations: z
        .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.coerce.number().positive().max(100) }))
        .min(1)
        .max(30),
    })
    .passthrough()
    .optional(),
});
const backtest = z.object({
  allocations: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.coerce.number().positive().max(100) }))
    .min(1)
    .max(30),
});
const compare = z.object({
  symbolA: z.string().min(1).max(12),
  symbolB: z.string().min(1).max(12),
  goal: z.string().max(300).optional(),
});
const rebalance = z.object({
  holdings: z
    .array(z.object({ symbol: z.string().min(1).max(12), usdValue: z.coerce.number().min(0).max(10_000_000) }))
    .max(50),
  target: z
    .array(z.object({ symbol: z.string().min(1).max(12), weightPct: z.coerce.number().min(0).max(100) }))
    .min(1)
    .max(30),
  cashUsd: z.coerce.number().min(0).max(10_000_000).optional(),
});

// ── PARAM_SPECS registry (renders 400 fields[], 402 outputSchema, OpenAPI, llms) ──
export interface ParamField {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
  enum?: string[];
}

export interface ParamSpec {
  fields: ParamField[];
  queryExample: string;
  requiredAnyOf?: string[][];
}

export const PARAM_SPECS: Record<string, ParamSpec> = {
  "/v1/plan": {
    fields: [
      { name: "goal", type: "string", required: true, description: "Your investing goal in plain words.", example: "steady growth" },
      { name: "amountUsd", type: "number", required: true, description: "Budget in USD (min 1).", example: "200" },
      { name: "riskTolerance", type: "string", required: false, description: "Risk preference.", enum: ["conservative", "balanced", "aggressive"] },
    ],
    queryExample: `POST ${BASE_URL}/v1/plan?goal=steady%20growth&amountUsd=200&riskTolerance=balanced`,
  },
  "/v1/research": {
    fields: [{ name: "symbol", type: "string", required: true, description: "xStock symbol, e.g. AAPLx. GET /v1/universe lists all names.", example: "AAPLx" }],
    queryExample: `POST ${BASE_URL}/v1/research?symbol=AAPLx`,
  },
  "/v1/halal-screen": {
    fields: [{ name: "symbols", type: "string (CSV) or string[]", required: true, description: "1-50 tickers, CSV in the query string.", example: "AAPLx,MSFTx" }],
    queryExample: `POST ${BASE_URL}/v1/halal-screen?symbols=AAPLx,MSFTx`,
  },
  "/v1/basket": {
    fields: [
      { name: "basket", type: "string", required: true, description: `Basket id: ${Object.keys(BASKETS).join(", ")}. Also accepted as the URL path /v1/basket/{id}.`, example: "halal" },
      { name: "amountUsd", type: "number", required: true, description: "Budget in USD (min 1).", example: "100" },
    ],
    queryExample: `POST ${BASE_URL}/v1/basket/halal?amountUsd=100`,
  },
  "/v1/build": {
    fields: [
      { name: "amountUsd", type: "number", required: true, description: "Budget in USD (min 1).", example: "40" },
      { name: "planId", type: "string", required: false, description: "A planId from a purchased plan/basket or from free POST /v1/build/stage." },
      { name: "symbols", type: "string (CSV)", required: false, description: "Scalar form: with weights.", example: "AAPLx,NVDAx" },
      { name: "weights", type: "string (CSV)", required: false, description: "Scalar form: percent weights matching symbols.", example: "60,40" },
      { name: "plan", type: "object (JSON body only)", required: false, description: "Nested Allocation JSON — cannot ride a query string." },
    ],
    queryExample: `POST ${BASE_URL}/v1/build?planId=0x...&amountUsd=40`,
    requiredAnyOf: [["planId"], ["symbols", "weights"], ["plan"]],
  },
  "/v1/backtest": {
    fields: [
      { name: "symbols", type: "string (CSV)", required: true, description: "Tickers.", example: "AAPLx,NVDAx" },
      { name: "weights", type: "string (CSV)", required: true, description: "Percent weights matching symbols.", example: "60,40" },
    ],
    queryExample: `POST ${BASE_URL}/v1/backtest?symbols=AAPLx,NVDAx&weights=60,40`,
    requiredAnyOf: [["symbols", "weights"], ["allocations"]],
  },
  "/v1/screener": { fields: [], queryExample: `POST ${BASE_URL}/v1/screener` },
  "/v1/compare": {
    fields: [
      { name: "symbolA", type: "string", required: true, description: "First ticker.", example: "AAPLx" },
      { name: "symbolB", type: "string", required: true, description: "Second ticker (must differ).", example: "MSFTx" },
      { name: "goal", type: "string", required: false, description: "Optional goal for the verdict." },
    ],
    queryExample: `POST ${BASE_URL}/v1/compare?symbolA=AAPLx&symbolB=MSFTx`,
  },
  "/v1/rebalance": {
    fields: [
      { name: "holdings", type: "string (CSV of SYMBOL:usd)", required: true, description: "Current holdings.", example: "AAPLx:120,MSFTx:80" },
      { name: "target", type: "string (CSV of SYMBOL:pct)", required: true, description: "Target weights, summing to ~100.", example: "AAPLx:60,NVDAx:40" },
      { name: "cashUsd", type: "number", required: false, description: "Extra cash to deploy." },
    ],
    queryExample: `POST ${BASE_URL}/v1/rebalance?holdings=AAPLx:120,MSFTx:80&target=AAPLx:60,NVDAx:40`,
  },
};

function extras(path: string, overrides: Partial<ErrorExtras> = {}): ErrorExtras {
  const spec = PARAM_SPECS[path];
  return {
    code: "INVALID_PARAM",
    inputRequired: true,
    retryable: true,
    fields: spec?.fields.map((f) => ({ name: f.name, type: f.type, required: f.required, description: f.description })),
    requiredAnyOf: spec?.requiredAnyOf ?? null,
    hint: spec?.queryExample,
    docs: LLMS_URL,
    ...overrides,
  };
}

function unknownSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.filter((s) => assetBySymbol(s) === undefined))];
}

export interface PrecheckProblem {
  status: number;
  message: string;
  extras: ErrorExtras;
}

/**
 * Validate a paid request before charging. Returns a problem (→ error response,
 * no payment) or null (proceed to the payment gate). `input` should already be
 * passed through normalizeForRoute. Async because /v1/build planId references
 * resolve from KV here, before the gate.
 */
export async function prevalidate(
  path: string,
  basketIdFromPath: string | null,
  input: Record<string, unknown>,
  env: Env
): Promise<PrecheckProblem | null> {
  const fail = (message: string, o: Partial<ErrorExtras> = {}, status = 400): PrecheckProblem => ({
    status,
    message: `${message} Nothing was charged.`,
    extras: extras(path, o),
  });

  if (path === "/v1/plan") {
    const r = AllocateRequestSchema.safeParse(input);
    return r.success ? null : fail('missing or invalid params: provide goal (string) and amountUsd (number).', { code: "MISSING_PARAM" });
  }
  if (path === "/v1/research") {
    const r = research.safeParse(input);
    if (!r.success) return fail('missing required query param "symbol".', { code: "MISSING_PARAM" });
    return assetBySymbol(r.data.symbol)
      ? null
      : fail(`Unknown symbol: ${r.data.symbol}. GET /v1/universe lists all names.`, { code: "UNKNOWN_SYMBOL" }, 400);
  }
  if (path === "/v1/halal-screen") {
    const r = halal.safeParse(input);
    return r.success ? null : fail('missing required query param "symbols" (CSV, 1-50 tickers).', { code: "MISSING_PARAM" });
  }
  if (path === "/v1/basket") {
    const r = basket.safeParse(input);
    if (!r.success) return fail('missing required query param "amountUsd" (number, min 1).', { code: "MISSING_PARAM" });
    const id = basketIdFromPath || r.data.basket || "";
    return id in BASKETS
      ? null
      : fail(`Unknown basket: ${id || "(none given)"}. Available: ${Object.keys(BASKETS).join(", ")}.`, { code: "UNKNOWN_BASKET" });
  }
  if (path === "/v1/build") {
    const r = buildSchema.safeParse(input);
    if (!r.success) {
      return fail('provide amountUsd plus ONE OF: planId, symbols+weights (CSV), or a JSON body {plan}.', { code: "MISSING_PARAM" });
    }
    if (r.data.planId) {
      const stored = (await env.KV.get(`plan:${r.data.planId}`, "json").catch(() => null)) as { plan?: unknown } | null;
      if (!stored?.plan) {
        return fail(
          `planId unknown or expired (30-day TTL): ${r.data.planId}. If bought within the last minute, storage propagation can take up to ~60 s — retry then. External plans: stage free at POST /v1/build/stage.`,
          { code: "PLAN_NOT_FOUND", retryAfterSeconds: 60 },
          404
        );
      }
      return null;
    }
    if (!r.data.plan) {
      return fail('provide amountUsd plus ONE OF: planId, symbols+weights (CSV), or a JSON body {plan}.', { code: "MISSING_PARAM" });
    }
    const bad = unknownSymbols(r.data.plan.allocations.map((a) => a.symbol));
    if (bad.length > 0) return fail(`Unknown symbols in plan: ${bad.join(", ")}.`, { code: "UNKNOWN_SYMBOL" });
    // $1 dust floor pre-check (post-payment dust 400s are forbidden)
    const total = r.data.plan.allocations.reduce((s, a) => s + a.weightPct, 0) || 1;
    const dust = r.data.plan.allocations.filter((a) => (a.weightPct / total) * r.data.amountUsd < 1);
    if (dust.length > 0) {
      return fail(`Legs below the $1 dust floor: ${dust.map((a) => a.symbol).join(", ")}. Increase amountUsd or trim the plan.`, {});
    }
    return null;
  }
  if (path === "/v1/backtest") {
    const r = backtest.safeParse(input);
    if (!r.success) return fail('provide symbols+weights (CSV query params) or JSON allocations[].', { code: "MISSING_PARAM" });
    const bad = unknownSymbols(r.data.allocations.map((a) => a.symbol));
    return bad.length === 0 ? null : fail(`Unknown symbols: ${bad.join(", ")}.`, { code: "UNKNOWN_SYMBOL" });
  }
  if (path === "/v1/compare") {
    const r = compare.safeParse(input);
    if (!r.success) return fail('missing required query params "symbolA" and "symbolB".', { code: "MISSING_PARAM" });
    if (r.data.symbolA.toLowerCase() === r.data.symbolB.toLowerCase()) {
      return fail("Pick two different stocks to compare.", {});
    }
    const bad = unknownSymbols([r.data.symbolA, r.data.symbolB]);
    return bad.length === 0 ? null : fail(`Unknown symbol: ${bad.join(", ")}.`, { code: "UNKNOWN_SYMBOL" });
  }
  if (path === "/v1/rebalance") {
    const r = rebalance.safeParse(input);
    if (!r.success) {
      return fail('provide holdings (CSV of SYMBOL:usd) and target (CSV of SYMBOL:pct).', { code: "MISSING_PARAM" });
    }
    const targetSum = r.data.target.reduce((s, t) => s + t.weightPct, 0);
    if (Math.abs(targetSum - 100) > 1) {
      return fail(`Target weights must sum to ~100 (got ${Math.round(targetSum)}).`, {});
    }
    const totalUsd = r.data.holdings.reduce((s, h) => s + h.usdValue, 0) + (r.data.cashUsd ?? 0);
    if (totalUsd < 1) return fail("Portfolio too small to rebalance (under $1).", {});
    const bad = unknownSymbols([...r.data.holdings.map((h) => h.symbol), ...r.data.target.map((t) => t.symbol)]);
    return bad.length === 0 ? null : fail(`Unknown symbols: ${bad.join(", ")}.`, { code: "UNKNOWN_SYMBOL" });
  }
  return null; // screener and anything else without required input
}
