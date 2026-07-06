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

export default {
  fetch: (handler as { fetch: typeof fetch }).fetch,

  // Fired by Cloudflare on the schedule in wrangler.jsonc. Self-invokes the
  // Next.js cron route through the service binding so the OpenNext runtime
  // (env, store, executor) handles the actual work.
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const secret = env.AUTOPILOT_CRON_SECRET;
    if (!secret) return; // autopilot not configured on this deployment
    ctx.waitUntil(
      env.WORKER_SELF_REFERENCE.fetch("https://monvera.xyz/api/cron/autopilot", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
  },
};
