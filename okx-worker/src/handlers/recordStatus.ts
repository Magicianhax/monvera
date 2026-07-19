// Free on-chain commitment check — served from the contract's used(planId)
// view (X Layer public-RPC eth_getLogs is unreliable; the view is not).
import { createPublicClient, http, type Hex } from "viem";
import type { Env } from "../env";
import { json, errorJson } from "../respond";
import { VERA_RECORD_V2_ABI, xlayerChain } from "../record";

const BOUNDARY =
  "A commitment proves Vera signed the recommendation before delivery. It does not prove the buyer executed, that fills matched, or that the plan performed. Track record = recommendations, not results.";

export async function handleRecordStatus(planId: string, env: Env): Promise<Response> {
  if (!/^0x[0-9a-f]{64}$/i.test(planId)) {
    return errorJson(400, `Invalid planId: expected 0x + 64 hex chars. External (ext-) staged plans are never recorded on-chain.`, {
      code: "INVALID_PARAM",
    });
  }
  const contract = env.VERA_RECORD_V2_ADDRESS as Hex | undefined;
  if (!contract) return errorJson(404, "Record contract not configured.", { code: "NOT_FOUND" });

  const reader = createPublicClient({ chain: xlayerChain, transport: http() });
  try {
    const committed = await reader.readContract({
      address: contract,
      abi: VERA_RECORD_V2_ABI,
      functionName: "used",
      args: [planId as Hex],
    });
    const kvEntry = (await env.KV.get(`rec:${planId}`, "json").catch(() => null)) as { txHash?: string } | null;
    return json({
      planId,
      committed,
      txHash: kvEntry?.txHash,
      contract,
      explorer: `https://www.oklink.com/x-layer/address/${contract}`,
      note: committed
        ? "used(planId) is true on-chain: this exact recommendation (payer + content + spend) was committed."
        : "Not committed (yet). Commits land within ~1 minute of purchase; only /v1/plan and /v1/basket record.",
      boundary: BOUNDARY,
    });
  } catch {
    return errorJson(502, "X Layer RPC is temporarily unavailable — could not read the contract.", {
      code: "UPSTREAM_FAILED",
      retryable: true,
      retryAfterSeconds: 30,
    });
  }
}
