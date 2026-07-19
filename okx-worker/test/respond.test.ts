import { json, errorJson } from "../src/respond";

test("json sets content-type and status", async () => {
  const r = json({ ok: true }, { status: 201 });
  expect(r.status).toBe(201);
  expect(r.headers.get("content-type")).toBe("application/json");
  expect(await r.json()).toEqual({ ok: true });
});

test("errorJson wraps message with agent-actionable defaults", async () => {
  const r = errorJson(400, "bad input");
  expect(r.status).toBe(400);
  const body = (await r.json()) as { error: string; charged: boolean; docs: string };
  expect(body.error).toBe("bad input");
  expect(body.charged).toBe(false);
  expect(body.docs).toContain("llms.txt");
});
