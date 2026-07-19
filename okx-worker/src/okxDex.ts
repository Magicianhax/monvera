// OKX DEX aggregator client (V6 API — V5 returns code 50050 deprecated).
// Trial keys are limited to ~1 RPS; callers must pace themselves.
import type { Env } from "./env";

const BASE = "https://web3.okx.com";
export const SOLANA_CHAIN_INDEX = "501";

type OkxQuoteData = {
  toTokenAmount?: string;
  priceImpactPercentage?: string;
  dexRouterList?: Array<{
    toToken?: { decimal?: string; tokenUnitPrice?: string; tokenContractAddress?: string };
  }>;
};

export async function okxHeaders(env: Env, method: string, pathWithQuery: string): Promise<HeadersInit> {
  const ts = new Date().toISOString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.OKX_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + method + pathWithQuery));
  return {
    "OK-ACCESS-KEY": env.OKX_API_KEY,
    "OK-ACCESS-SIGN": btoa(String.fromCharCode(...new Uint8Array(sig))),
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": env.OKX_PASSPHRASE,
    "Content-Type": "application/json",
  };
}

export type OkxQuoteResult =
  | {
      ok: true;
      toAmount: string;
      toDecimals: number;
      unitPriceUsd: number | undefined;
      priceImpactPct: number | undefined;
    }
  | { ok: false; code: string; msg: string };

export async function getOkxQuote(
  env: Env,
  args: { fromMint: string; toMint: string; amountBaseUnits: bigint }
): Promise<OkxQuoteResult> {
  const path =
    `/api/v6/dex/aggregator/quote?chainIndex=${SOLANA_CHAIN_INDEX}` +
    `&fromTokenAddress=${args.fromMint}&toTokenAddress=${args.toMint}&amount=${args.amountBaseUnits}`;
  let quote: OkxQuoteData;
  try {
    const res = await fetch(BASE + path, {
      headers: await okxHeaders(env, "GET", path),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { code?: string; msg?: string; data?: OkxQuoteData[] }
      | null;
    if (!body || body.code !== "0" || !body.data?.[0]) {
      return { ok: false, code: body?.code ?? String(res.status), msg: body?.msg ?? "quote failed" };
    }
    quote = body.data[0];
  } catch (err) {
    return { ok: false, code: "network", msg: err instanceof Error ? err.message : "fetch failed" };
  }
  const target = quote.dexRouterList
    ?.flatMap((r) => (r.toToken ? [r.toToken] : []))
    .find((t) => t.tokenContractAddress === args.toMint);
  return {
    ok: true,
    toAmount: quote.toTokenAmount ?? "0",
    toDecimals: target?.decimal !== undefined ? Number(target.decimal) : 9,
    unitPriceUsd: target?.tokenUnitPrice !== undefined ? Number(target.tokenUnitPrice) : undefined,
    priceImpactPct: quote.priceImpactPercentage !== undefined ? Number(quote.priceImpactPercentage) : undefined,
  };
}
