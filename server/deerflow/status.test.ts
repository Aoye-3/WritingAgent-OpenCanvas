import test from "node:test";
import assert from "node:assert/strict";
import { getDeerFlowRuntimeStatus } from "./status.js";

test("reports TypeScript fallback when DeerFlow is disabled", async () => {
  const status = await getDeerFlowRuntimeStatus({
    config: { enabled: false, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" }
  });

  assert.equal(status.enabled, false);
  assert.equal(status.reachable, false);
  assert.equal(status.runtimeProvider, "typescript");
});

test("reports DeerFlow reachable when health check succeeds", async () => {
  const status = await getDeerFlowRuntimeStatus({
    config: { enabled: true, baseUrl: "http://deerflow.local", assistantId: "lead_agent" },
    fetchImpl: async () => new Response(JSON.stringify({ status: "healthy" }), { status: 200 }) as Response
  });

  assert.equal(status.enabled, true);
  assert.equal(status.reachable, true);
  assert.equal(status.runtimeProvider, "deerflow");
  assert.equal(status.lastError, undefined);
});

test("reports DeerFlow unreachable without throwing", async () => {
  const status = await getDeerFlowRuntimeStatus({
    config: { enabled: true, baseUrl: "http://deerflow.local", assistantId: "lead_agent" },
    fetchImpl: async () => new Response("nope", { status: 503 }) as Response
  });

  assert.equal(status.enabled, true);
  assert.equal(status.reachable, false);
  assert.equal(status.runtimeProvider, "deerflow");
  assert.match(status.lastError ?? "", /HTTP 503/);
});
