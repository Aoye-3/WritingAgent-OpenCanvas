import test from "node:test";
import assert from "node:assert/strict";
import { getAgentBackendDashboard } from "./dashboard.js";
import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import type { AgentCard } from "../../agentCards.js";
import { clearAgentBackendSession } from "./auth.js";

test("dashboard returns runtime, config, agent mapping, and tool bridge status", async () => {
  clearAgentBackendSession();
  const dashboard = await getAgentBackendDashboard({
    agentRuntime: fakeAgentRuntime(),
    config: authConfig(),
    fetchImpl: async (url) => {
      const textUrl = String(url);
      if (textUrl.endsWith("/health")) return Response.json({ status: "healthy" });
      if (textUrl.endsWith("/api/v1/auth/setup-status")) return Response.json({ needs_setup: false });
      if (textUrl.endsWith("/api/v1/auth/login/local")) return responseWithSession({ ok: true });
      if (textUrl.endsWith("/api/skills")) return Response.json({ skills: [{ name: "research", enabled: true }] });
      if (textUrl.endsWith("/api/mcp/config")) {
        return Response.json({
          mcp_servers: {
            search: {
              enabled: true,
              env: { API_TOKEN: "secret", SAFE_FLAG: "ok" }
            }
          }
        });
      }
      return new Response("not found", { status: 404 });
    }
  });

  assert.equal(dashboard.runtime.reachable, true);
  assert.equal(dashboard.runtime.authState, "authenticated");
  assert.equal(dashboard.config.skills.length, 1);
  assert.equal(dashboard.agentMappings[0].subagent.name, "facetwrite-summary");
  assert.equal(dashboard.agentMappings[0].subagent.skills[0], "summary");
  assert.equal(dashboard.toolBridgeStatus.some((item) => item.name === "canvas_write" && item.bridgeState === "facetwrite_bridge" && item.approvalBoundary === "FacetWrite pending approval"), true);
  assert.equal(dashboard.toolBridgeStatus.some((item) => item.name === "web_search" && item.bridgeState === "agent_backend_builtin"), true);
  assert.equal(dashboard.integrationMaturity.some((item) => item.label === "ToolUse bridge" && item.state === "verified"), true);
  assert.equal(dashboard.config.mcpServers.search && JSON.stringify(dashboard.config.mcpServers.search).includes("secret"), false);
});

test("dashboard shows fallback state when AgentBackend is disabled", async () => {
  const dashboard = await getAgentBackendDashboard({
    agentRuntime: fakeAgentRuntime(),
    config: { enabled: false, baseUrl: "http://127.0.0.1:8000", assistantId: "lead_agent" }
  });

  assert.equal(dashboard.runtime.runtimeProvider, "typescript");
  assert.equal(dashboard.runtime.reachable, false);
  assert.equal(dashboard.config.enabled, false);
  assert.equal(dashboard.agentMappings[0].contractState, "fallback_only");
});

function fakeAgentRuntime() {
  return {
    listAgentCards: () => [summaryCard]
  } as Pick<AgentRuntimeAdapter, "listAgentCards"> as AgentRuntimeAdapter;
}

const summaryCard: AgentCard = {
  id: "summary",
  category: "summarise",
  accent: "green",
  icon: "lines",
  title: { en: "Summary", zh: "摘要" },
  description: { en: "Summarise text", zh: "摘要文本" },
  identityPrompt: "Summarise clearly.",
  skillRefs: ["summary"],
  toolRefs: ["knowledge_base", "canvas_write"],
  outputContract: { type: "summary", defaultFormat: "markdown" },
  defaultValues: {},
  fields: []
};

function authConfig() {
  return {
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
}

function responseWithSession(payload: unknown) {
  const headers = new Headers();
  headers.append("set-cookie", "access_token=session; Path=/; HttpOnly");
  headers.append("set-cookie", "csrf_token=csrf; Path=/");
  return Response.json(payload, { headers });
}
