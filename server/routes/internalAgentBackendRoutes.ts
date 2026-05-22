import type { Express } from "express";
import type { SQLiteStorageRepository } from "../storage.js";
import type { KnowledgeService } from "../knowledge/service.js";
import { registerInternalToolBridgeRoute } from "./internalAgentRuntimeRoutes.js";

type InternalAgentBackendRouteDeps = {
  storage: SQLiteStorageRepository;
  knowledgeService?: KnowledgeService;
};

export function registerInternalAgentBackendRoutes(app: Express, deps: InternalAgentBackendRouteDeps) {
  registerInternalToolBridgeRoute(app, "/api/internal/agent-backend/tool-call", deps, "AgentBackend");
}
