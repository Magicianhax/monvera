// Free execution-funding check: does this Solana wallet hold enough USDC (and
// SOL for fees) to execute legs of a given size? Run BEFORE paying for a plan —
// prevents the "paid for research, cannot execute" surprise.
//
// Balances come from OKX's authenticated balance API (public Solana RPCs
// reject datacenter/Worker IPs; OKX does not, and we already carry its key).
import type { Env } from "../env";
import { json, errorJson, PREREQUISITES } from "../respond";
import { USDC_SOL_MINT } from "../universe";
import { okxHeaders } from "../okxDex";
import { rateLimit } from "./rateLimit";

const MIN_SOL_FOR_FEES = 0.005;

interface TokenAsset {
  chainIndex?: string;
  symbol?: string;
  balance?: string;
  tokenContractAddress?: string;
}

export async function handlePreflight(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const limited = await rateLimit(request, env, ctx, "preflight");
  if (limited) return limited;

  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const amountUsd = Number(url.searchParams.get("amountUsd") ?? "0");
  if (!wallet || wallet.length < 32 || wallet.length > 44) {
    return errorJson(400, 'missing or invalid query param "wallet" (Solana address that will execute legs).', {
      code: "MISSING_PARAM",
      hint: "GET /v1/preflight?wallet=<solana-address>&amountUsd=100",
    });
  }

  try {
    const path = `/api/v6/dex/balance/all-token-balances-by-address?address=${wallet}&chains=501`;
    const res = await fetch(`https://web3.okx.com${path}`, {
      headers: await okxHeaders(env, "GET", path),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { code?: string; data?: Array<{ tokenAssets?: TokenAsset[] }> }
      | null;
    if (!body || body.code !== "0") throw new Error(`balance lookup failed (${body?.code ?? res.status})`);

    const assets = body.data?.[0]?.tokenAssets ?? [];
    const usdcBalance = Number(assets.find((a) => a.tokenContractAddress === USDC_SOL_MINT)?.balance ?? 0);
    const solBalance = Number(
      assets.find((a) => a.symbol === "SOL" || a.tokenContractAddress === "" || a.tokenContractAddress === undefined)
        ?.balance ?? 0
    );

    const needsUsd = amountUsd > 0 ? amountUsd : null;
    const usdcOk = needsUsd === null ? usdcBalance > 0 : usdcBalance >= needsUsd;
    const solOk = solBalance >= MIN_SOL_FOR_FEES;
    const hints: string[] = [];
    if (!usdcOk) {
      hints.push(
        needsUsd === null
          ? `No USDC found. Fund ${wallet} with USDC (${USDC_SOL_MINT}) on Solana before executing legs.`
          : `USDC balance ${usdcBalance} is below the ${needsUsd} needed. Fund ${wallet} with USDC on Solana.`
      );
    }
    if (!solOk) hints.push(`SOL balance ${solBalance} is below ~${MIN_SOL_FOR_FEES} needed for transaction fees.`);
    if (usdcOk && solOk) hints.push("Funded. Buy a plan or basket, then execute its legs from this wallet.");

    return json({
      wallet,
      amountUsd: needsUsd,
      usdcBalance,
      solBalance,
      sufficient: usdcOk && solOk,
      hints,
      prerequisites: PREREQUISITES,
    });
  } catch {
    return errorJson(502, "Balance lookup is temporarily unavailable — could not check funding. This does not affect payments.", {
      code: "UPSTREAM_FAILED",
      retryable: true,
      retryAfterSeconds: 30,
    });
  }
}
