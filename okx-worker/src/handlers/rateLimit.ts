// Best-effort per-IP rate limit for the free write/RPC surfaces (KV counter;
// cross-region lag makes it approximate, which is fine for abuse damping).
import type { Env } from "../env";
import { errorJson } from "../respond";

const LIMIT_PER_MINUTE = 30;

export async function rateLimit(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  route: string
): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${route}:${minute}`;
  const count = Number((await env.KV.get(key).catch(() => null)) ?? 0);
  if (count >= LIMIT_PER_MINUTE) {
    return errorJson(429, `Rate limited (${LIMIT_PER_MINUTE}/min on this endpoint). Try again shortly.`, {
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 60,
    });
  }
  ctx.waitUntil(env.KV.put(key, String(count + 1), { expirationTtl: 120 }).catch(() => undefined));
  return null;
}
