// The agent-autonomy guarantees from the blueprint: method matrix, the
// no-charge invariant, CSV transport coercions, stage->build, and the
// anti-drift checks that keep discovery artifacts true to the gate.
import { route } from "../src/router";
import { resetX402ServerForTests, PAID_ROUTES, PRICES } from "../src/x402";
import { prevalidate, normalizeForRoute, PARAM_SPECS } from "../src/precheck";
import { OKX_SWAP_PARAMS, SUGGESTED_SLIPPAGE_PERCENT } from "../src/legs";
import { catalog, llmsTxt, openapi, wellKnownX402 } from "../src/discovery";
import { handleBuildStage } from "../src/handlers/buildStage";
import { handleBuild } from "../src/handlers/build";

function kvStub(store: Map<string, string> = new Map()) {
  return {
    get: async (k: string, type?: string) => {
      const v = store.get(k) ?? null;
      return v !== null && type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

const store = new Map<string, string>();
const env = {
  OKX_API_KEY: "k",
  OKX_SECRET_KEY: "s",
  OKX_PASSPHRASE: "p",
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  KV: kvStub(store),
} as never;
const ctx = { waitUntil: (p: Promise<unknown>) => p.catch(() => undefined) } as never;

const supportedResponse = () =>
  new Response(
    JSON.stringify({
      code: "0",
      data: { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }], extensions: [], signers: {} },
    })
  );

function mockFacilitatorOnly() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/pay/x402/supported")) return supportedResponse();
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as never;
}

beforeEach(() => {
  resetX402ServerForTests();
  store.clear();
  mockFacilitatorOnly();
});

// ── method matrix ────────────────────────────────────────────────────────────
test("unsigned GET on every paid route returns 402 (never 404, never the product)", async () => {
  for (const path of Object.keys(PAID_ROUTES)) {
    const r = await route(new Request(`https://asp.example${path}`, { method: "GET" }), env, ctx);
    expect(r.status, path).toBe(402);
    expect(r.headers.get("PAYMENT-REQUIRED"), path).toBeTruthy();
  }
});

test("unsigned GET can never leak the free product (free-product leak guard)", async () => {
  const r = await route(new Request("https://asp.example/v1/screener", { method: "GET" }), env, ctx);
  expect(r.status).toBe(402);
  const body = (await r.json()) as { code: string };
  expect(body.code).toBe("PAYMENT_REQUIRED");
});

test("unsigned malformed POST keeps the byte-level 400 'Nothing was charged' behavior", async () => {
  const r = await route(new Request("https://asp.example/v1/plan", { method: "POST", body: "{}" }), env, ctx);
  expect(r.status).toBe(400);
  const body = (await r.json()) as { error: string; charged: boolean; fields: unknown[]; hint: string };
  expect(body.error).toContain("Nothing was charged");
  expect(body.charged).toBe(false);
  expect(Array.isArray(body.fields)).toBe(true);
  expect(body.hint).toContain("/v1/plan?");
});

// ── CSV transport coercions (pure query-string deliverability) ───────────────
test("every array param has a working scalar CSV encoding", async () => {
  const halal = normalizeForRoute("/v1/halal-screen", { symbols: "AAPLx,MSFTx" });
  expect(halal.symbols).toEqual(["AAPLx", "MSFTx"]);

  const backtest = normalizeForRoute("/v1/backtest", { symbols: "AAPLx,NVDAx", weights: "60,40" });
  expect(backtest.allocations).toEqual([
    { symbol: "AAPLx", weightPct: 60 },
    { symbol: "NVDAx", weightPct: 40 },
  ]);

  const build = normalizeForRoute("/v1/build", { symbols: "AAPLx,NVDAx", weights: "60,40", amountUsd: "40" });
  expect((build.plan as { allocations: unknown[] }).allocations).toHaveLength(2);

  const rebalance = normalizeForRoute("/v1/rebalance", { holdings: "AAPLx:120,MSFTx:80", target: "AAPLx:60,NVDAx:40" });
  expect(rebalance.holdings).toEqual([
    { symbol: "AAPLx", usdValue: 120 },
    { symbol: "MSFTx", usdValue: 80 },
  ]);
  expect(rebalance.target).toEqual([
    { symbol: "AAPLx", weightPct: 60 },
    { symbol: "NVDAx", weightPct: 40 },
  ]);
});

test("prevalidate rejects unknown planId as uncharged 404 with retry guidance", async () => {
  const problem = await prevalidate(
    "/v1/build",
    null,
    { planId: "0x" + "ab".repeat(32), amountUsd: 40 },
    env
  );
  expect(problem?.status).toBe(404);
  expect(problem?.message).toContain("Nothing was charged");
  expect(problem?.extras.code).toBe("PLAN_NOT_FOUND");
  expect(problem?.extras.retryAfterSeconds).toBe(60);
});

// ── stage -> build roundtrip (query-safe external plans) ─────────────────────
test("stage->build roundtrip: external JSON becomes a query-string-deliverable planId", async () => {
  const plan = {
    allocations: [
      { symbol: "AAPLx", weightPct: 60, reason: "x" },
      { symbol: "NVDAx", weightPct: 40, reason: "y" },
    ],
  };
  const staged = await handleBuildStage(
    new Request("https://asp.example/v1/build/stage", { method: "POST", body: JSON.stringify(plan) }),
    env,
    ctx
  );
  expect(staged.status).toBe(200);
  const { planId } = (await staged.json()) as { planId: string };
  expect(planId).toMatch(/^ext-[0-9a-f]{64}$/);

  // Same content stages to the same id (idempotent / content-addressed).
  const again = await handleBuildStage(
    new Request("https://asp.example/v1/build/stage", { method: "POST", body: JSON.stringify(plan) }),
    env,
    ctx
  );
  expect(((await again.json()) as { planId: string }).planId).toBe(planId);

  // The staged id is usable via pure query string.
  const built = await handleBuild(
    new Request(`https://asp.example/v1/build?planId=${planId}&amountUsd=40`, { method: "POST", body: "{}" }),
    env
  );
  expect(built.status).toBe(200);
  const body = (await built.json()) as { legs: Array<{ symbol: string; amountIn: string }>; costs: { executionReferralFee: { percent: string } } };
  expect(body.legs).toHaveLength(2);
  expect(body.legs.reduce((s, l) => s + Number(l.amountIn), 0)).toBe(40_000_000);
  expect(body.costs.executionReferralFee.percent).toBe(OKX_SWAP_PARAMS.feePercent);
});

// ── anti-drift: discovery artifacts render from the live source of truth ─────
test("catalog fee disclosure equals the charged okxSwapParams and prices", () => {
  const cat = catalog(env) as {
    costs: { executionReferralFee: { percent: string; recipient: string }; feeSchedule: { examples: Array<{ orderUsd: number; basketAllInPct: string }> } };
    services: Array<{ path: string; priceUsd: number }>;
  };
  expect(cat.costs.executionReferralFee.percent).toBe(OKX_SWAP_PARAMS.feePercent);
  expect(cat.costs.executionReferralFee.recipient).toBe(OKX_SWAP_PARAMS.fromTokenReferrerWalletAddress);
  // Fee schedule numbers recompute from PRICES + feePercent (never hand-written).
  const ex1000 = cat.costs.feeSchedule.examples.find((e) => e.orderUsd === 1000)!;
  const expected = (((PRICES.basket + 1000 * (Number(OKX_SWAP_PARAMS.feePercent) / 100)) / 1000) * 100).toFixed(2);
  expect(ex1000.basketAllInPct).toBe(expected);
  const planService = cat.services.find((s) => s.path === "POST /v1/plan")!;
  expect(planService.priceUsd).toBe(PRICES.plan);
});

test("llms.txt encodes the fee percent, slippage, transport rule and signing domain", () => {
  const txt = llmsTxt(env);
  expect(txt).toContain(`${OKX_SWAP_PARAMS.feePercent}% execution referral`);
  expect(txt).toContain(`slippagePercent=${SUGGESTED_SLIPPAGE_PERCENT}`);
  expect(txt).toContain("QUERY STRING");
  expect(txt).toContain('name: "USD₮0"');
  expect(txt).toContain("Token-2022");
  expect(txt).toContain("BASE58");
  expect(txt).toContain("previously undisclosed");
});

test("openapi and well-known accepts match challengeEntryFor for every paid route", () => {
  const api = openapi(env) as { paths: Record<string, { post?: { "x-x402"?: { accepts: Array<{ amount: string; payTo: string }> } } }> };
  const wk = wellKnownX402(env) as { resources: Array<{ resource: string; accepts: Array<{ amount: string }> }> };
  for (const [path, key] of Object.entries(PAID_ROUTES)) {
    const amount = String(Math.round(PRICES[key] * 1_000_000));
    expect(api.paths[path]?.post?.["x-x402"]?.accepts[0]?.amount, path).toBe(amount);
    const res = wk.resources.find((r) => r.resource.endsWith(path))!;
    expect(res.accepts[0].amount, path).toBe(amount);
  }
});

test("PARAM_SPECS covers every paid route with a copy-pasteable example", () => {
  for (const path of Object.keys(PAID_ROUTES)) {
    const spec = PARAM_SPECS[path];
    expect(spec, path).toBeDefined();
    expect(spec.queryExample, path).toContain("https://vera.monvera.best");
  }
});
