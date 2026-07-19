import { getOkxQuote } from "../src/okxDex";

const env = { OKX_API_KEY: "k", OKX_SECRET_KEY: "s", OKX_PASSPHRASE: "p" } as never;

test("parses a successful quote incl. target-token metadata", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        code: "0",
        data: [
          {
            toTokenAmount: "12345678",
            priceImpactPercentage: "0.4",
            dexRouterList: [
              { toToken: { decimal: "8", tokenUnitPrice: "333.03", tokenContractAddress: "MINT_B" } },
            ],
          },
        ],
      })
    )) as never;
  const q = await getOkxQuote(env, { fromMint: "MINT_A", toMint: "MINT_B", amountBaseUnits: 50_000_000n });
  expect(q).toEqual({
    ok: true,
    toAmount: "12345678",
    toDecimals: 8,
    unitPriceUsd: 333.03,
    priceImpactPct: 0.4,
  });
});

test("surfaces OKX error codes instead of throwing", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: "82000", msg: "insufficient liquidity", data: [] }))) as never;
  const q = await getOkxQuote(env, { fromMint: "A", toMint: "B", amountBaseUnits: 1n });
  expect(q.ok).toBe(false);
  if (!q.ok) expect(q.code).toBe("82000");
});

test("network failure returns ok:false, never throws", async () => {
  globalThis.fetch = (async () => {
    throw new Error("boom");
  }) as never;
  const q = await getOkxQuote(env, { fromMint: "A", toMint: "B", amountBaseUnits: 1n });
  expect(q.ok).toBe(false);
  if (!q.ok) expect(q.code).toBe("network");
});
