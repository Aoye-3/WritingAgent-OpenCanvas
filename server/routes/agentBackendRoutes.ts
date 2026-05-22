import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { AgentRuntimePort } from "../runtime/agentRuntimePort.js";
import { sendOk } from "../utils/http.js";

export function registerAgentBackendRoutes(app: Express, deps: { agentRuntime: AgentRuntimeAdapter; executionRuntime: AgentRuntimePort }) {
  app.get("/api/agent-backend/status", async (_request, response) => {
    sendOk(response, await deps.executionRuntime.getStatus());
  });

  app.get("/api/agent-backend/config", async (_request, response) => {
    sendOk(response, await deps.executionRuntime.getConfigOverview());
  });

  app.get("/api/agent-backend/dashboard", async (_request, response) => {
    sendOk(response, await deps.executionRuntime.getDashboard({ agentRuntime: deps.agentRuntime }));
  });
}
