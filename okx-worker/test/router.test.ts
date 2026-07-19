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
  expect(body.services.length).toBe(6);
});

test("paid route without payment gets 402 + challenge header", async () => {
  mockFetch((url) => (url.includes("/pay/x402/supported") ? supportedResponse() : null));
  const r = await route(
    new Request("https://asp.example/v1/plan", { method: "POST", body: "{}" }),
    env,
    ctx
  );
  expect(r.status).toBe(402);
  expect(r.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
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

test("unknown basket id 404s BEFORE the payment gate (never charge for a 404)", async () => {
  mockFetch(() => null); // no facilitator call may happen
  const r = await route(
    new Request("https://asp.example/v1/basket/nonsense", { method: "POST", body: "{}" }),
    env,
    ctx
  );
  expect(r.status).toBe(404);
});

test("valid basket id is payment-gated", async () => {
  mockFetch((url) => (url.includes("/pay/x402/supported") ? supportedResponse() : null));
  const r = await route(
    new Request("https://asp.example/v1/basket/halal", { method: "POST", body: "{}" }),
    env,
    ctx
  );
  expect(r.status).toBe(402);
  expect(r.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
});
