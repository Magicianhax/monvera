import { json, errorJson } from "../src/respond";

test("json sets content-type and status", async () => {
  const r = json({ ok: true }, { status: 201 });
  expect(r.status).toBe(201);
  expect(r.headers.get("content-type")).toBe("application/json");
  expect(await r.json()).toEqual({ ok: true });
});

test("errorJson wraps message", async () => {
  const r = errorJson(400, "bad input");
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "bad input" });
});
