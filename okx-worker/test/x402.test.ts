import {
  verifyAndSettle,
  resetX402ServerForTests,
  USDT0_XLAYER,
  challengeEntryFor,
  PRICES,
  PAID_ROUTES,
  decodeBase64Json,
} from "../src/x402";

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
  const out = await verifyAndSettle(new Request("https://asp.example/v1/plan", { method: "POST" }), env);
  expect(out.kind).toBe("challenge");
  if (out.kind !== "challenge") return;
  expect(out.response.status).toBe(402);
  const header = out.response.headers.get("PAYMENT-REQUIRED");
  expect(header).toBeTruthy();
  const challenge = decodeBase64Json(header!) as {
    x402Version: number;
    accepts: Array<{ scheme: string; network: string; asset: string; amount: string; payTo: string }>;
  };
  expect(challenge.x402Version).toBe(2);
  const accept = challenge.accepts[0];
  expect(accept.scheme).toBe("exact");
  expect(accept.network).toBe("eip155:196");
  expect(accept.asset.toLowerCase()).toBe(USDT0_XLAYER);
  expect(accept.amount).toBe("500000"); // $0.50 in 6dp
  expect(accept.payTo).toBe("0x1111111111111111111111111111111111111111");
});

test("the 402 body carries the decoded challenge, signing contract and how-to", async () => {
  const out = await verifyAndSettle(new Request("https://asp.example/v1/plan", { method: "POST" }), env, ["goal", "amountUsd"]);
  if (out.kind !== "challenge") throw new Error("expected challenge");
  const body = (await out.response.json()) as {
    code: string;
    charged: boolean;
    x402: { accepts: Array<{ amount: string }> } | null;
    signing: { eip712Domain: { name: string; chainId: number }; template: string };
    how: string[];
    params: { missing: string[]; example: string };
    prerequisites: { execution: { asset: string } };
  };
  expect(body.code).toBe("PAYMENT_REQUIRED");
  expect(body.charged).toBe(false);
  expect(body.x402?.accepts[0]?.amount).toBe("500000");
  expect(body.signing.eip712Domain.name).toBe("USD₮0");
  expect(body.signing.eip712Domain.chainId).toBe(196);
  expect(body.signing.template).toContain("PAYMENT-SIGNATURE");
  expect(body.how.length).toBeGreaterThanOrEqual(3);
  expect(body.params.missing).toEqual(["goal", "amountUsd"]);
  expect(body.prerequisites.execution.asset).toBe("USDC");
});

test("basket wildcard route is payment-gated at $0.35", async () => {
  const out = await verifyAndSettle(new Request("https://asp.example/v1/basket/halal", { method: "POST" }), env);
  if (out.kind !== "challenge") throw new Error("expected challenge");
  const challenge = decodeBase64Json(out.response.headers.get("PAYMENT-REQUIRED")!) as {
    accepts: Array<{ amount: string }>;
  };
  expect(challenge.accepts[0].amount).toBe("350000");
});

test("challengeEntryFor matches the live 402 accepts for every paid route", async () => {
  for (const path of Object.keys(PAID_ROUTES)) {
    const out = await verifyAndSettle(new Request(`https://asp.example${path}`, { method: "POST" }), env);
    if (out.kind !== "challenge") throw new Error(`expected challenge for ${path}`);
    const decoded = decodeBase64Json(out.response.headers.get("PAYMENT-REQUIRED")!) as {
      accepts: Array<{
        amount: string;
        asset: string;
        payTo: string;
        network: string;
        scheme: string;
        maxTimeoutSeconds: number;
        extra: Record<string, string>;
      }>;
    };
    const live = decoded.accepts[0];
    const rendered = challengeEntryFor(path, "0x1111111111111111111111111111111111111111")!;
    // The anti-drift guarantee: the discovery entry equals the live challenge
    // on every field the buyer signs over.
    expect(live.amount).toBe(rendered.amount);
    expect(live.asset.toLowerCase()).toBe(rendered.asset.toLowerCase());
    expect(live.payTo.toLowerCase()).toBe(rendered.payTo.toLowerCase());
    expect(live.network).toBe(rendered.network);
    expect(live.scheme).toBe(rendered.scheme);
    expect(live.maxTimeoutSeconds).toBe(rendered.maxTimeoutSeconds);
    expect(live.extra).toEqual(rendered.extra);
  }
});

test("routes outside the paid table pass through unpaid", async () => {
  const out = await verifyAndSettle(new Request("https://asp.example/v1/quote/AAPLx", { method: "GET" }), env);
  expect(out.kind).toBe("paid"); // free pass-through
});

test("prices cover all paid routes", () => {
  expect(Object.keys(PAID_ROUTES).length).toBe(9);
  for (const key of Object.values(PAID_ROUTES)) expect(PRICES[key]).toBeGreaterThanOrEqual(0.25);
});
