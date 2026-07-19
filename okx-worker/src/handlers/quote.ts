// Free funnel endpoint: live OKX quote + liquidity snapshot for one xStock.
import type { Env } from "../env";
import { json, errorJson } from "../respond";
import { assetBySymbol, USDC_SOL_MINT } from "../universe";
import { getOkxQuote } from "../okxDex";

const CACHE_TTL_S = 60;

export async function handleQuote(symbol: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const asset = assetBySymbol(symbol);
  if (!asset) return errorJson(404, `Unknown symbol: ${symbol}`);

  const cacheKey = `quote:v1:${asset.mint}`;
  const cached = await env.KV.get(cacheKey, "json").catch(() => null);
  if (cached) return json(cached);

  const quote = await getOkxQuote(env, {
    fromMint: USDC_SOL_MINT,
    toMint: asset.mint,
    amountBaseUnits: 50_000_000n, // $50 reference size
  });
  const body = {
    symbol: asset.symbol,
    name: asset.name,
    underlying: asset.underlying,
    mint: asset.mint,
    chainIndex: "501",
    quote50Usd: quote.ok
      ? {
          toAmount: quote.toAmount,
          toDecimals: quote.toDecimals,
          unitPriceUsd: quote.unitPriceUsd ?? null,
          priceImpactPct: quote.priceImpactPct ?? null,
        }
      : null,
    note: quote.ok ? undefined : `Quote unavailable right now (${quote.msg}).`,
  };
  if (quote.ok) {
    ctx.waitUntil(
      env.KV.put(cacheKey, JSON.stringify(body), { expirationTtl: CACHE_TTL_S }).catch(() => undefined)
    );
  }
  return json(body);
}
