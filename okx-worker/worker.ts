import type { Env } from "./src/env";
import { errorJson } from "./src/respond";
import { route } from "./src/router";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return route(request, env, ctx).catch((err: unknown) => {
      console.error("unhandled", err);
      return errorJson(500, "internal error");
    });
  },
} satisfies ExportedHandler<Env>;
