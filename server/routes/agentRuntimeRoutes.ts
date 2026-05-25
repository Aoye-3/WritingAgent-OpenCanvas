import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { AgentRuntimePort } from "../runtime/agentRuntimePort.js";
import type { AgentRuntimeMemoryService } from "../services/agentRuntimeMemoryService.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type AgentRuntimeRouteDeps = {
  agentRuntime: AgentRuntimeAdapter;
  executionRuntime: AgentRuntimePort;
  memoryService?: AgentRuntimeMemoryService;
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

  app.get("/api/agent-runtime/memory", async (_request, response) => {
    try {
      const memory = await deps.memoryService?.readMemory() ?? { content: "" };
      sendOk(response, {
        memory,
        agentMemory: readAgentMemoryState(deps.agentRuntime)
      });
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to read Agent Runtime memory"));
    }
  });

  app.put("/api/agent-runtime/memory", async (request, response) => {
    try {
      if (!deps.memoryService) throw new Error("Agent Runtime memory service is unavailable");
      const body = request.body && typeof request.body === "object" ? request.body as { content?: unknown } : {};
      const memory = await deps.memoryService.saveMemory(body.content ?? "");
      sendOk(response, {
        memory,
        agentMemory: readAgentMemoryState(deps.agentRuntime)
      });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to save Agent Runtime memory"));
    }
  });

  app.delete("/api/agent-runtime/memory", async (_request, response) => {
    try {
      if (!deps.memoryService) throw new Error("Agent Runtime memory service is unavailable");
      const memory = await deps.memoryService.clearMemory();
      sendOk(response, {
        memory,
        agentMemory: readAgentMemoryState(deps.agentRuntime)
      });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to clear Agent Runtime memory"));
    }
  });
}

function readAgentMemoryState(agentRuntime: AgentRuntimeAdapter) {
  const agents = agentRuntime.listAgentCards().map((card) => ({
    agentCardId: card.id,
    title: card.title,
    enabled: Boolean(card.settings?.memory.enabled)
  }));
  return {
    enabledAgents: agents.filter((agent) => agent.enabled).length,
    totalAgents: agents.length,
    agents
  };
}
