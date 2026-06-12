import type { Express } from "express";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";
import { randomProjectId, safeId } from "../utils/ids.js";

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

  app.get("/api/projects/:projectId/threads", (request, response) => {
    const project = storage.getProject(request.params.projectId);
    if (!project) return sendError(response, 404, "not_found", "Project not found");
    sendOk(response, { threads: storage.listProjectThreads(request.params.projectId) });
  });

  app.post("/api/projects", (request, response) => {
    try {
      const projectId = safeId(request.body?.projectId) ?? randomProjectId();
      sendOk(response, { project: storage.createProject(projectId, request.body?.title ?? "Untitled project") });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create project"));
    }
  });

  app.patch("/api/projects/:projectId", (request, response) => {
    try {
      const project = storage.renameProject(request.params.projectId, request.body?.title);
      if (!project) return sendError(response, 404, "not_found", "Project not found");
      sendOk(response, { project });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to rename project"));
    }
  });

  app.put("/api/projects/:projectId/models", (request, response) => {
    try {
      const ids = Array.isArray(request.body?.configuredModelApiIds)
        ? request.body.configuredModelApiIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      sendOk(response, { configuredModelApiIds: storage.setProjectModelBindings(request.params.projectId, ids) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to bind project models"));
    }
  });

  app.get("/api/projects/:projectId/canvas/assets/:objectId/content", async (request, response) => {
    try {
      const content = await storage.readCanvasAsset(request.params.projectId, request.params.objectId);
      if (!content) return sendError(response, 404, "not_found", "Canvas asset not found");
      response.type(content.extension || "application/octet-stream").send(content.content);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to read Canvas asset"));
    }
  });

  app.post("/api/projects/:projectId/trash", (request, response) => {
    if (!storage.moveProjectToTrash(request.params.projectId)) return sendError(response, 404, "not_found", "Project not found");
    sendOk(response, { ok: true });
  });

  app.post("/api/projects/:projectId/restore", (request, response) => {
    if (!storage.restoreProject(request.params.projectId)) return sendError(response, 404, "not_found", "Project not found");
    sendOk(response, { ok: true });
  });

  app.delete("/api/projects/:projectId", async (request, response) => {
    if (!await storage.hardDeleteProject(request.params.projectId)) return sendError(response, 404, "not_found", "Project must be in trash before hard delete");
    sendOk(response, { ok: true });
  });
}
