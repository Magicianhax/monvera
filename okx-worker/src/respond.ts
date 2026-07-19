export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export function errorJson(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/**
 * Merged request input: URL query params with the JSON body layered on top.
 * A2MCP callers vary in where they put business params; accept both everywhere.
 */
export async function requestInput(request: Request): Promise<Record<string, unknown>> {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  return { ...query, ...(body ?? {}) };
}
