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
  assert.equal(status.authState, "not_configured");
});

test("reports DeerFlow reachable when health check succeeds", async () => {
  const status = await getDeerFlowRuntimeStatus({
    config: authConfig(),
    fetchImpl: async (url) => {
      const textUrl = String(url);
      if (textUrl.endsWith("/health")) return Response.json({ status: "healthy" });
      if (textUrl.endsWith("/api/v1/auth/setup-status")) return Response.json({ needs_setup: false });
      if (textUrl.endsWith("/api/v1/auth/login/local")) {
        const headers = new Headers();
        headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
        headers.append("set-cookie", "csrf_token=csrf; Path=/");
        return Response.json({ ok: true }, {
          headers
        });
      }
      return new Response("not found", { status: 404 });
    }
  });

  assert.equal(status.enabled, true);
  assert.equal(status.reachable, true);
  assert.equal(status.runtimeProvider, "deerflow");
  assert.equal(status.authState, "authenticated");
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
  assert.equal(status.authState, "auth_failed");
  assert.match(status.lastError ?? "", /HTTP 503/);
});

function authConfig() {
  return {
    enabled: true,
    baseUrl: "http://deerflow.local",
    assistantId: "lead_agent",
    auth: {
      email: "admin@example.com",
      password: "strong-password",
      autoSetup: false,
      timeoutMs: 5000
    }
  };
}
