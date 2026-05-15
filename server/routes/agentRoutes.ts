import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type AgentRouteDeps = {
  agentRuntime: AgentRuntimeAdapter;
};

export function registerAgentRoutes(app: Express, { agentRuntime }: AgentRouteDeps) {
  app.get("/api/agent-cards", (_request, response) => {
    sendOk(response, { agentCards: agentRuntime.listAgentCards() });
  });

  app.get("/api/agent-cards/:agentCardId/settings", (request, response) => {
    sendOk(response, { settings: agentRuntime.getAgentSettings(request.params.agentCardId) });
  });

  app.get("/api/agent-cards/:agentCardId/runtime-config", async (request, response) => {
    try {
      sendOk(response, await agentRuntime.getAgentRuntimeConfig(request.params.agentCardId));
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to load Agent runtime config"));
    }
  });

  app.put("/api/agent-cards/:agentCardId/settings", (request, response) => {
    try {
      const settings = agentRuntime.saveAgentSettings(request.params.agentCardId, request.body?.settings);
      sendOk(response, { settings, agentCard: agentRuntime.resolveAgentCard(request.params.agentCardId) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to save Agent settings"));
    }
  });
}
