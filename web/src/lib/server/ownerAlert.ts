import "server-only";

// Paging the owner, in one place.
//
// Split out of autoRebalance.ts so a caller that only needs to RAISE an alert —
// the rebalance watchdog, for instance — does not have to import the whole
// rebalance engine (viem clients, the planner, the model chain) to do it.
import { addNotification } from "./notifyStore";

/** RED events page the owner through the ordinary notification inbox.
 *  OWNER_USER_ID is the owner's user-directory id (wrangler.jsonc vars);
 *  unset means alerting is off — deliberately, so a fork or preview without
 *  the var never pages anyone. */
export async function alertOwner(title: string, body: string): Promise<void> {
  const owner = process.env.OWNER_USER_ID;
  if (!owner) return;
  await addNotification(owner, { kind: "system", title: `Auto-manage: ${title}`, body, at: Date.now() });
}
