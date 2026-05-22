import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { AgentRuntimePort } from "../runtime/agentRuntimePort.js";
import { sendOk } from "../utils/http.js";

type AgentRuntimeRouteDeps = {
  agentRuntime: AgentRuntimeAdapter;
  executionRuntime: AgentRuntimePort;
};

export function registerAgentRuntimeRoutes(app: Express, deps: AgentRuntimeRouteDeps) {
  app.get("/api/agent-runtime/status", async (_request, response) => {
    sendOk(response, await deps.executionRuntime.getStatus());
  });

  app.get("/api/agent-runtime/config", async (_request, response) => {
    sendOk(response, await deps.executionRuntime.getConfigOverview());
  });

  app.get("/api/agent-runtime/dashboard", async (_request, response) => {
    sendOk(response, await deps.executionRuntime.getDashboard({ agentRuntime: deps.agentRuntime }));
  });
}
