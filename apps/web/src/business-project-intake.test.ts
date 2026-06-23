import { strict as assert } from "node:assert";
import test from "node:test";
import { archiveBusinessProjectIntake, listBusinessProjectIntakes } from "./business-project-intake";

const originalFetch = globalThis.fetch;

test("business project intake helpers", async t => {
  await t.test("requests archived project intakes when asked", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ intakes: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await listBusinessProjectIntakes({ includeArchived: true });
    assert.equal(calls.length, 1);
    assert.ok(String(calls[0]?.input).includes("includeArchived=true"));
    assert.equal(calls[0]?.init?.credentials, "include");
  });

  await t.test("archives project intakes with the governed archive route", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ intake: { id: "intake-1", archivedAt: "2026-06-23T00:00:00.000Z" } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const intake = await archiveBusinessProjectIntake("intake-1");
    assert.equal(intake.id, "intake-1");
    assert.equal(intake.archivedAt, "2026-06-23T00:00:00.000Z");
    assert.equal(calls.length, 1);
    assert.ok(String(calls[0]?.input).endsWith("/api/business-control-centre/project-intakes/intake-1/archive"));
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.credentials, "include");
  });
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
