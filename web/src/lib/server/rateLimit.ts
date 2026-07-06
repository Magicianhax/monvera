import "server-only";

// Minimal in-memory fixed-window rate limiter. Per-process, so it protects a
// single instance (enough for the hackathon / single-region deploy). For a
// multi-instance production deploy, swap the Map for Upstash/Redis with the
// same interface.
interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
let calls = 0;

/** Drop expired windows occasionally so the map can't grow without bound. */
function sweep(now: number) {
  if (++calls % 500 !== 0) return;
  for (const [key, w] of buckets) {
    if (now >= w.resetAt) buckets.delete(key);
  }
}

export interface RateResult {
  ok: boolean;
  retryAfter: number; // seconds until the window resets
}

/**
 * Count one hit against `key`. Allows up to `limit` hits per `windowMs`.
 * Returns ok=false (with retryAfter) once the limit is exceeded.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now);
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** Best-effort client IP from proxy headers (Vercel/Next set x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
