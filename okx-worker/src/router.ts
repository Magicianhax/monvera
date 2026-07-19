// Placeholder until Task 9 wires the real routes; the signature is final.
import type { Env } from "./env";

export async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return new Response("vera-okx", { status: 200 });
}
