import test from "node:test";
import assert from "node:assert/strict";
import { authenticatedAgentBackendFetch, clearAgentBackendSession, getAgentBackendAuthStatus } from "./auth.js";
import type { AgentBackendRuntimeConfig } from "./config.js";

const config: AgentBackendRuntimeConfig = {
  enabled: true,
  baseUrl: "http://AgentBackend.local",
  assistantId: "lead_agent",
  auth: {
    email: "admin@example.com",
    password: "strong-password",
    autoSetup: false,
    timeoutMs: 5000
  }
};

test("reports setup required when auto setup is disabled", async () => {
  clearAgentBackendSession();
  const status = await getAgentBackendAuthStatus({
    config,
    fetchImpl: async (url) => {
      assert.equal(String(url), "http://AgentBackend.local/api/v1/auth/setup-status");
      return Response.json({ needs_setup: true });
    }
  });

  assert.equal(status.authState, "setup_required");
  assert.match(status.lastError ?? "", /setup is required/);
});

test("auto setup initializes admin and caches session", async () => {
  clearAgentBackendSession();
  const calls: string[] = [];
  const status = await getAgentBackendAuthStatus({
    config: { ...config, auth: { ...config.auth!, autoSetup: true } },
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).endsWith("/setup-status")) {
        return Response.json({ needs_setup: true });
      }
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers && new Headers(init.headers).get("Content-Type"), "application/json");
      return responseWithSession({ id: "admin" });
    }
  });

  assert.equal(status.authState, "authenticated");
  assert.deepEqual(calls, [
    "GET http://AgentBackend.local/api/v1/auth/setup-status",
    "POST http://AgentBackend.local/api/v1/auth/initialize"
  ]);
});

test("login success authenticates protected fetch with cookie and csrf", async () => {
  clearAgentBackendSession();
  let protectedHeaders = new Headers();
  const response = await authenticatedAgentBackendFetch({
    config,
    path: "/api/runs/stream",
    init: { method: "POST", body: "{}" },
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/setup-status")) return Response.json({ needs_setup: false });
      if (String(url).endsWith("/login/local")) return responseWithSession({ ok: true });
      protectedHeaders = new Headers(init?.headers);
      return Response.json({ ok: true });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(protectedHeaders.get("Cookie"), "access_token=session-value; csrf_token=csrf-value");
  assert.equal(protectedHeaders.get("X-CSRF-Token"), "csrf-value");
});

test("falls back to direct login when setup status is rate limited", async () => {
  clearAgentBackendSession();
  const calls: string[] = [];
  const response = await authenticatedAgentBackendFetch({
    config,
    path: "/api/runs/stream",
    init: { method: "POST", body: "{}" },
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).endsWith("/setup-status")) return new Response("rate limited", { status: 429 });
      if (String(url).endsWith("/login/local")) return responseWithSession({ ok: true });
      return Response.json({ ok: true });
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.slice(0, 2), [
    "GET http://AgentBackend.local/api/v1/auth/setup-status",
    "POST http://AgentBackend.local/api/v1/auth/login/local"
  ]);
});

test("401 or 403 clears session and retries login once", async () => {
  clearAgentBackendSession();
  const calls: string[] = [];
  const response = await authenticatedAgentBackendFetch({
    config,
    path: "/api/skills",
    init: { method: "GET" },
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).endsWith("/setup-status")) return Response.json({ needs_setup: false });
      if (String(url).endsWith("/login/local")) return responseWithSession({ ok: true });
      return new Response(calls.filter((call) => call.endsWith("/api/skills")).length === 1 ? "forbidden" : "ok", {
        status: calls.filter((call) => call.endsWith("/api/skills")).length === 1 ? 403 : 200
      });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls.filter((call) => call.endsWith("/api/v1/auth/login/local")).length, 2);
  assert.equal(calls.filter((call) => call.endsWith("/api/skills")).length, 2);
});

test("concurrent protected requests share one auth session setup", async () => {
  clearAgentBackendSession();
  let setupStatusCalls = 0;
  let loginCalls = 0;

  const fetchImpl = async (url: string | URL | Request) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/setup-status")) {
      setupStatusCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ needs_setup: false });
    }
    if (textUrl.endsWith("/login/local")) {
      loginCalls += 1;
      return responseWithSession({ ok: true });
    }
    return Response.json({ ok: true });
  };

  await Promise.all([
    authenticatedAgentBackendFetch({ config, path: "/api/skills", init: { method: "GET" }, fetchImpl }),
    authenticatedAgentBackendFetch({ config, path: "/api/mcp/config", init: { method: "GET" }, fetchImpl })
  ]);

  assert.equal(setupStatusCalls, 1);
  assert.equal(loginCalls, 1);
});

test("auth failure reports safe error without secrets", async () => {
  clearAgentBackendSession();
  const status = await getAgentBackendAuthStatus({
    config,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/setup-status")) return Response.json({ needs_setup: false });
      return new Response("bad credentials", { status: 401 });
    }
  });

  assert.equal(status.authState, "auth_failed");
  assert.match(status.lastError ?? "", /HTTP 401/);
  assert.doesNotMatch(status.lastError ?? "", /strong-password|session-value|csrf-value/);
});

function responseWithSession(payload: unknown) {
  const headers = new Headers();
  headers.append("set-cookie", "access_token=session-value; Path=/; HttpOnly");
  headers.append("set-cookie", "csrf_token=csrf-value; Path=/; SameSite=strict");
  return Response.json(payload, {
    headers
  });
}
