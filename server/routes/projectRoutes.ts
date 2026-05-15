import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { SQLiteStorageRepository } from "../storage.js";
import { sendOk } from "../utils/http.js";

type ProjectRouteDeps = {
  storage: SQLiteStorageRepository;
  agentRuntime: AgentRuntimeAdapter;
};

export function registerProjectRoutes(app: Express, { storage, agentRuntime }: ProjectRouteDeps) {
  app.get("/api/projects", (_request, response) => {
    sendOk(response, { projects: storage.listProjects(agentRuntime.listAgentCards()) });
  });

  app.get("/api/projects/trash", (_request, response) => {
    sendOk(response, { projects: storage.listProjects(agentRuntime.listAgentCards(), true) });
  });
}
