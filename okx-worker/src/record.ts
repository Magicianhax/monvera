// VeraRecordV2 signing + X Layer commit. Stub until Task 10 wires the
// contract; the final behavior contract already holds: no-ops (returns
// undefined) when VERA_RECORD_V2_ADDRESS is unset, never blocks the response.
import type { Allocation } from "./allocation-schema";
import type { Env } from "./env";

export interface RecordReceipt {
  planId: string;
  txQueued: boolean;
}

export async function commitRecord(
  env: Env,
  ctx: ExecutionContext,
  plan: Allocation,
  payer: string,
  usdSpent: number
): Promise<RecordReceipt | undefined> {
  if (!env.VERA_RECORD_V2_ADDRESS) return undefined;
  return undefined; // Task 10 replaces this with sign + writeContract via ctx.waitUntil
}
