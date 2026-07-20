// Custom Cloudflare worker entry: wraps the OpenNext-generated handler and adds
// the scheduled() hook so Cloudflare Cron Triggers drive the Autopilot runs
// (wrangler.jsonc: triggers.crons). Without this the cron route would never be
// invoked on Cloudflare (there is no always-on server).
//
// Types are structural on purpose: this file is bundled by wrangler, not Next,
// and `.open-next/worker.js` only exists after `opennextjs-cloudflare build`.
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore -- generated at build time by `opennextjs-cloudflare build`
import handler from "./.open-next/worker.js";

interface Env {
  /** Service binding back to this worker (declared in wrangler.jsonc). */
  WORKER_SELF_REFERENCE: { fetch: typeof fetch };
  AUTOPILOT_CRON_SECRET?: string;
}

const nextFetch = (handler as { fetch: typeof fetch }).fetch;

export default {
  // Canonicalize the host before the app runs: www and the workers.dev origin
  // both 301 to the apex, so shared links, SEO, and Privy origins resolve to one
  // host. Everything else falls straight through to the OpenNext handler.
  // (Cron self-invocation uses the WORKER_SELF_REFERENCE service binding, not the
  // public host, so it is unaffected.)
  fetch(request: Request, env: Env, ctx: unknown) {
    const url = new URL(request.url);
    if (url.hostname === "www.monvera.best" || url.hostname.endsWith(".workers.dev")) {
      url.hostname = "monvera.best";
      return Response.redirect(url.toString(), 301);
    }
    return (nextFetch as (r: Request, e: Env, c: unknown) => Response | Promise<Response>)(request, env, ctx);
  },

  // Fired by Cloudflare on the schedule in wrangler.jsonc. Self-invokes the
  // Next.js cron route through the service binding so the OpenNext runtime
  // (env, store, executor) handles the actual work.
  async scheduled(event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const secret = env.AUTOPILOT_CRON_SECRET;
    if (!secret) return; // crons not configured on this deployment
    const cron = (event as { cron?: string }).cron ?? "";
    const hit = (path: string) =>
      env.WORKER_SELF_REFERENCE.fetch(`https://monvera.best${path}`, {
        headers: { authorization: `Bearer ${secret}` },
      });
    // every 15 min: price alerts; on the hour: autopilot; Mondays 13:00 UTC: weekly digest.
    ctx.waitUntil(hit("/api/cron/alerts"));
    if (cron === "0 * * * *") {
      ctx.waitUntil(hit("/api/cron/autopilot"));
      // Hourly two-way liquidity sweep — feeds /api/tradability from KV.
      ctx.waitUntil(hit("/api/cron/tradability"));
      // Hourly balance snapshots — the real equity curve (D1, /api/balance-history).
      ctx.waitUntil(hit("/api/cron/balances"));
    }
    if (cron === "0 13 * * 1") ctx.waitUntil(hit("/api/cron/digest"));
    // Keep the $MONVERA chart warm: the route persists every successful series
    // to KV for 24h, so even occasional upstream luck keeps all ranges served.
    // Sequential with gaps — a burst would guarantee the upstream 429.
    ctx.waitUntil(
      (async () => {
        for (const range of ["5m", "1h", "4h", "1d", "7d"]) {
          try {
            await env.WORKER_SELF_REFERENCE.fetch(`https://monvera.best/api/token-chart?range=${range}`);
          } catch {
            /* best-effort */
          }
          await new Promise((r) => setTimeout(r, 4_000));
        }
      })(),
    );
  },
};
