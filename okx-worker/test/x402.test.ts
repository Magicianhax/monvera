import { requirePayment, resetX402ServerForTests, USDT0_XLAYER } from "../src/x402";

const env = {
  OKX_API_KEY: "k",
  OKX_SECRET_KEY: "s",
  OKX_PASSPHRASE: "p",
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
} as never;

// Mock only the facilitator's /supported endpoint (hit once at initialize).
function mockFacilitator() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/pay/x402/supported")) {
      return new Response(
        JSON.stringify({
          code: "0",
          data: {
            kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }],
            extensions: [],
            signers: {},
          },
        })
      );
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as never;
}

beforeEach(() => {
  resetX402ServerForTests();
  mockFacilitator();
});

test("unpaid /v1/plan gets a 402 with a v2 challenge for USDT0 on X Layer", async () => {
  const out = await requirePayment(new Request("https://asp.example/v1/plan", { method: "POST" }), env);
  expect(out.paid).toBe(false);
  if (out.paid) return;
  expect(out.response.status).toBe(402);
  const header = out.response.headers.get("PAYMENT-REQUIRED");
  expect(header).toBeTruthy();
  const challenge = JSON.parse(atob(header!));
  expect(challenge.x402Version).toBe(2);
  const accept = challenge.accepts[0];
  expect(accept.scheme).toBe("exact");
  expect(accept.network).toBe("eip155:196");
  expect(accept.asset.toLowerCase()).toBe(USDT0_XLAYER);
  expect(accept.amount).toBe("500000"); // $0.50 in 6dp USDT0
  expect(accept.payTo).toBe("0x1111111111111111111111111111111111111111");
});

test("basket wildcard route is payment-gated at $0.35", async () => {
  const out = await requirePayment(
    new Request("https://asp.example/v1/basket/halal", { method: "POST" }),
    env
  );
  expect(out.paid).toBe(false);
  if (out.paid) return;
  const challenge = JSON.parse(atob(out.response.headers.get("PAYMENT-REQUIRED")!));
  expect(challenge.accepts[0].amount).toBe("350000");
});

test("routes outside the paid table pass through unpaid", async () => {
  const out = await requirePayment(new Request("https://asp.example/v1/quote/AAPLx", { method: "GET" }), env);
  expect(out.paid).toBe(true);
});
