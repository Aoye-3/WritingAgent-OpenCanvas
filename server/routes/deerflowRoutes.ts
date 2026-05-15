import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { getDeerFlowDashboard } from "../deerflow/dashboard.js";
import { getDeerFlowConfigOverview } from "../deerflow/proxy.js";
import { getDeerFlowRuntimeStatus } from "../deerflow/status.js";
import { sendOk } from "../utils/http.js";

export function registerDeerFlowRoutes(app: Express, deps: { agentRuntime: AgentRuntimeAdapter }) {
  app.get("/api/deerflow/status", async (_request, response) => {
    sendOk(response, await getDeerFlowRuntimeStatus());
  });

  app.get("/api/deerflow/config", async (_request, response) => {
    sendOk(response, await getDeerFlowConfigOverview());
  });

  app.get("/api/deerflow/dashboard", async (_request, response) => {
    sendOk(response, await getDeerFlowDashboard({ agentRuntime: deps.agentRuntime }));
  });
}
