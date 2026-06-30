import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { clearAgentBackendSession } from "../runtime/agentBackendAdapter/auth.js";
import { registerGenerationRoutes } from "./generationRoutes.js";

test("runtime run events route proxies sanitized raw events", async () => {
  clearAgentBackendSession();
  const previousFetch = globalThis.fetch;
  const previousEnabled = process.env.AGENT_BACKEND_ENABLED;
  const previousEmail = process.env.AGENT_BACKEND_AUTH_EMAIL;
  const previousPassword = process.env.AGENT_BACKEND_AUTH_PASSWORD;
  const previousBaseUrl = process.env.AGENT_BACKEND_BASE_URL;
  const previousMode = process.env.AGENT_RUNTIME_MODE;
  process.env.AGENT_BACKEND_ENABLED = "true";
  process.env.AGENT_RUNTIME_MODE = "external";
  process.env.AGENT_BACKEND_BASE_URL = "http://AgentBackend.local";
  process.env.AGENT_BACKEND_AUTH_EMAIL = "admin@example.com";
  process.env.AGENT_BACKEND_AUTH_PASSWORD = "strong-password";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/auth/setup-status")) return Response.json({ needs_setup: false });
    if (url.endsWith("/api/v1/auth/login/local")) {
      const headers = new Headers();
      headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
      headers.append("set-cookie", "csrf_token=csrf; Path=/");
      return Response.json({ ok: true }, { headers });
    }
    assert.equal(url, "http://AgentBackend.local/api/threads/thread_1/runs/run_1/events?limit=500");
    return Response.json([
      { thread_id: "thread_1", run_id: "run_1", event_type: "human_message", category: "message", content: "hide me", seq: 1 },
      { thread_id: "thread_1", run_id: "run_1", event_type: "llm.tool.result", category: "message", content: { text: "ok", api_key: "secret" }, metadata: { token: "secret", tool: "web_search" }, seq: 2, created_at: "2026-06-14T00:00:00.000Z" }
    ]);
  };

  const app = express();
  app.use(express.json());
  registerGenerationRoutes(app, {
    generationService: {
      generateAndRecord: async () => { throw new Error("unused"); },
      generateAndRecordStream: async () => { throw new Error("unused"); }
    },
    canvasService: {} as never
  });

  try {
    const response = await localJsonRequest(app, "/api/generate/runs/run_1/events?threadId=thread_1", previousFetch);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.events, [{
      threadId: "thread_1",
      runId: "run_1",
      eventType: "llm.tool.result",
      category: "message",
      content: { text: "ok", api_key: "[redacted]" },
      metadata: { token: "[redacted]", tool: "web_search" },
      sequence: 2,
      createdAt: "2026-06-14T00:00:00.000Z"
    }]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("AGENT_BACKEND_ENABLED", previousEnabled);
    restoreEnv("AGENT_BACKEND_AUTH_EMAIL", previousEmail);
    restoreEnv("AGENT_BACKEND_AUTH_PASSWORD", previousPassword);
    restoreEnv("AGENT_BACKEND_BASE_URL", previousBaseUrl);
    restoreEnv("AGENT_RUNTIME_MODE", previousMode);
    clearAgentBackendSession();
  }
});

async function localJsonRequest(app: express.Express, path: string, fetchImpl: typeof fetch) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetchImpl(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
