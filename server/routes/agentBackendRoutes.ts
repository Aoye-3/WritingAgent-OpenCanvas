import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { getAgentBackendDashboard } from "../agentBackend/dashboard.js";
import { getAgentBackendConfigOverview } from "../agentBackend/proxy.js";
import { getAgentBackendRuntimeStatus } from "../agentBackend/status.js";
import { sendOk } from "../utils/http.js";

export function registerAgentBackendRoutes(app: Express, deps: { agentRuntime: AgentRuntimeAdapter }) {
  app.get("/api/agent-backend/status", async (_request, response) => {
    sendOk(response, await getAgentBackendRuntimeStatus());
  });

  app.get("/api/agent-backend/config", async (_request, response) => {
    sendOk(response, await getAgentBackendConfigOverview());
  });

  app.get("/api/agent-backend/dashboard", async (_request, response) => {
    sendOk(response, await getAgentBackendDashboard({ agentRuntime: deps.agentRuntime }));
  });
}
