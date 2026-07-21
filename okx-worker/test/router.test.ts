import { route } from "../src/router";
import { resetX402ServerForTests } from "../src/x402";

const env = {
  OKX_API_KEY: "k",
  OKX_SECRET_KEY: "s",
  OKX_PASSPHRASE: "p",
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  KV: { get: async () => null, put: async () => undefined },
} as never;
const ctx = { waitUntil: () => undefined } as never;

function mockFetch(handler: (url: string) => Response | null) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = handler(url);
    if (hit) return hit;
    throw new Error(`unexpected fetch: ${url}`);
  }) as never;
}

const supportedResponse = () =>
  new Response(
    JSON.stringify({
      code: "0",
      data: { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }], extensions: [], signers: {} },
    })
  );

beforeEach(() => resetX402ServerForTests());

test("GET / lists all services free", async () => {
  mockFetch(() => null);
  const r = await route(new Request("https://asp.example/"), env, ctx);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { services: unknown[] };
  expect(body.services.length).toBe(15);
});

test("valid paid request without payment gets 402 + challenge header", async () => {
  mockFetch((url) => (url.includes("/pay/x402/supported") ? supportedResponse() : null));
  const r = await route(
    new Request("https://asp.example/v1/plan", {
      method: "POST",
      body: JSON.stringify({ goal: "steady growth", amountUsd: 50 }),
    }),
    env,
    ctx
  );
  expect(r.status).toBe(402);
  expect(r.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  // exactly one content-type, with a charset: a duplicated header (the SDK spells
  // it `Content-Type`, we spelled it `content-type`) serialises as a comma list
  // and makes lenient clients decode non-ASCII copy as latin-1.
  expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
});

test("free and paid responses carry exactly one utf-8 content-type", async () => {
  mockFetch((url) => (url.includes("/pay/x402/supported") ? supportedResponse() : null));
  const catalog = await route(new Request("https://asp.example/"), env, ctx);
  const gated = await route(new Request("https://asp.example/v1/research", { method: "POST" }), env, ctx);
  const missing = await route(new Request("https://asp.example/nope"), env, ctx);
  for (const r of [catalog, gated, missing]) {
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
  }
});

test("signed malformed request is rejected BEFORE the payment gate (no charge)", async () => {
  mockFetch(() => null); // no facilitator call may happen (prevalidate rejects first)
  const r = await route(
    new Request("https://asp.example/v1/plan", {
      method: "POST",
      body: "{}",
      headers: { "PAYMENT-SIGNATURE": "ZHVtbXk=" },
    }),
    env,
    ctx
  );
  expect(r.status).toBe(400);
  const body = (await r.json()) as { error: string };
  expect(body.error).toContain("Nothing was charged");
});

test("query-string params satisfy the pre-payment validation", async () => {
  mockFetch((url) => (url.includes("/pay/x402/supported") ? supportedResponse() : null));
  const r = await route(
    new Request("https://asp.example/v1/basket/halal?amountUsd=40", { method: "POST", body: "{}" }),
    env,
    ctx
  );
  expect(r.status).toBe(402); // validation passed; only payment is missing
});

test("unknown symbol in a signed request is rejected before charging", async () => {
  mockFetch(() => null);
  const r = await route(
    new Request("https://asp.example/v1/research", {
      method: "POST",
      body: JSON.stringify({ symbol: "DOGE" }),
      headers: { "PAYMENT-SIGNATURE": "ZHVtbXk=" },
    }),
    env,
    ctx
  );
  expect(r.status).toBe(400);
});

test("free quote route responds without payment", async () => {
  mockFetch((url) =>
    url.includes("/dex/aggregator/quote")
      ? new Response(
          JSON.stringify({
            code: "0",
            data: [{ toTokenAmount: "150000", priceImpactPercentage: "0.2", dexRouterList: [] }],
          })
        )
      : null
  );
  const r = await route(new Request("https://asp.example/v1/quote/AAPLx"), env, ctx);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { symbol: string; quote50Usd: unknown };
  expect(body.symbol).toBe("AAPLx");
  expect(body.quote50Usd).not.toBeNull();
});

test("GET /v1/quote?symbol= (query form) works like the path form", async () => {
  mockFetch((url) =>
    url.includes("/dex/aggregator/quote")
      ? new Response(
          JSON.stringify({
            code: "0",
            data: [{ toTokenAmount: "150000", priceImpactPercentage: "0.2", dexRouterList: [] }],
          })
        )
      : null
  );
  const r = await route(new Request("https://asp.example/v1/quote?symbol=AAPLx"), env, ctx);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { symbol: string };
  expect(body.symbol).toBe("AAPLx");
});

test("unknown quote symbol is a 404", async () => {
  mockFetch(() => null);
  const r = await route(new Request("https://asp.example/v1/quote/NOPE"), env, ctx);
  expect(r.status).toBe(404);
});

test("unknown route is a 404 with a pointer", async () => {
  mockFetch(() => null);
  const r = await route(new Request("https://asp.example/nope"), env, ctx);
  expect(r.status).toBe(404);
});

test("unknown basket id in a signed request is rejected BEFORE the payment gate", async () => {
  mockFetch(() => null); // no facilitator call may happen
  const r = await route(
    new Request("https://asp.example/v1/basket/nonsense", {
      method: "POST",
      body: JSON.stringify({ amountUsd: 40 }),
      headers: { "PAYMENT-SIGNATURE": "ZHVtbXk=" },
    }),
    env,
    ctx
  );
  expect(r.status).toBe(400);
});

test("valid basket request is payment-gated", async () => {
  mockFetch((url) => (url.includes("/pay/x402/supported") ? supportedResponse() : null));
  const r = await route(
    new Request("https://asp.example/v1/basket/halal", {
      method: "POST",
      body: JSON.stringify({ amountUsd: 40 }),
    }),
    env,
    ctx
  );
  expect(r.status).toBe(402);
  expect(r.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
});
