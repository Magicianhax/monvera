import type { Env } from "./src/env";
import { errorJson, withCors } from "./src/respond";
import { route } from "./src/router";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    const response = await route(request, env, ctx).catch((err: unknown) => {
      console.error("unhandled", err);
      return errorJson(500, "internal error");
    });
    return withCors(response);
  },
} satisfies ExportedHandler<Env>;
