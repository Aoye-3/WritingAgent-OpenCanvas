import test from "node:test";
import assert from "node:assert/strict";
import { getDeerFlowConfigOverview } from "./proxy.js";

test("reads DeerFlow skills and sanitizes MCP secrets", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/api/skills")) {
      return Response.json({ skills: [{ name: "research", enabled: true }] });
    }
    if (textUrl.endsWith("/api/mcp/config")) {
      return Response.json({
        mcp_servers: {
          github: {
            enabled: true,
            command: "npx",
            env: { GITHUB_TOKEN: "secret-token", SAFE_FLAG: "ok" },
            headers: { Authorization: "Bearer secret", "X-Trace": "visible" },
            oauth: { client_secret: "oauth-secret", scope: "repo" }
          }
        }
      });
    }
    return new Response("not found", { status: 404 });
  };

  const overview = await getDeerFlowConfigOverview({
    config: { enabled: true, baseUrl: "http://deerflow.local", assistantId: "lead_agent" },
    fetchImpl
  });

  assert.deepEqual(overview.skills, [{ name: "research", enabled: true }]);
  const github = overview.mcpServers.github as {
    env: Record<string, string>;
    headers: Record<string, string>;
    oauth: Record<string, string>;
  };
  assert.equal(github.env.GITHUB_TOKEN, "[redacted]");
  assert.equal(github.env.SAFE_FLAG, "ok");
  assert.equal(github.headers.Authorization, "[redacted]");
  assert.equal(github.headers["X-Trace"], "visible");
  assert.equal(github.oauth.client_secret, "[redacted]");
  assert.equal(github.oauth.scope, "repo");
});

test("returns safe error shape when DeerFlow config is unreachable", async () => {
  const overview = await getDeerFlowConfigOverview({
    config: { enabled: true, baseUrl: "http://deerflow.local", assistantId: "lead_agent" },
    fetchImpl: async () => new Response("unavailable", { status: 503 }) as Response
  });

  assert.equal(overview.enabled, true);
  assert.deepEqual(overview.skills, []);
  assert.deepEqual(overview.mcpServers, {});
  assert.match(overview.lastError ?? "", /HTTP 503/);
});
