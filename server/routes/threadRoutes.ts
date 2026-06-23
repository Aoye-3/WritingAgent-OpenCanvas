import type { Express } from "express";
import { timelineEventFromToolEvent } from "../services/generation/runTimeline.js";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { resolveConversationModelId } from "../domains/model-config/index.js";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";
import { randomThreadId, safeId } from "../utils/ids.js";

type ThreadRouteDeps = {
  storage: SQLiteStorageRepository;
  agentRuntime: AgentRuntimeAdapter;
  resolveModelId?: typeof resolveConversationModelId;
};

export function registerThreadRoutes(app: Express, { storage, agentRuntime: _agentRuntime, resolveModelId = resolveConversationModelId }: ThreadRouteDeps) {
  app.get("/api/threads/recent", (_request, response) => {
    sendOk(response, { threads: storage.listRecentThreads() });
  });

  app.post("/api/threads", async (request, response) => {
    const threadId = safeId(request.body?.threadId) ?? randomThreadId();
    const projectId = safeId(request.body?.projectId);

    try {
      if (!projectId || !storage.getProject(projectId)) throw new Error("A valid projectId is required");
      let thread = await storage.ensureThread(threadId, projectId, request.body?.title ?? "New conversation");
      const configuredModelApiId = await resolveModelId([
        thread?.configuredModelApiId,
        storage.listProjectThreads(projectId).find((candidate) => candidate.configuredModelApiId)?.configuredModelApiId,
        storage.listRecentThreads().find((candidate) => candidate.configuredModelApiId)?.configuredModelApiId
      ]);
      if (configuredModelApiId && thread?.configuredModelApiId !== configuredModelApiId) {
        thread = storage.setThreadModelConfig(threadId, configuredModelApiId);
      }
      sendOk(response, { thread, threadId: thread?.id ?? threadId, projectId });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create thread"));
    }
  });

  app.post("/api/threads/batch-trash", (request, response) => {
    const threadIds = parseThreadIds(request.body?.threadIds);
    if (!threadIds) {
      sendError(response, 400, "bad_request", "threadIds must be a non-empty array");
      return;
    }

    const results = threadIds.map((threadId) => ({
      threadId,
      ok: storage.moveThreadToTrash(threadId)
    }));
    sendOk(response, {
      ok: true,
      results,
      movedCount: results.filter((result) => result.ok).length
    });
  });

  app.post("/api/threads/batch-delete", async (request, response) => {
    const threadIds = parseThreadIds(request.body?.threadIds);
    if (!threadIds) {
      sendError(response, 400, "bad_request", "threadIds must be a non-empty array");
      return;
    }

    try {
      const results = await Promise.all(threadIds.map(async (threadId) => ({
        threadId,
        ok: await storage.hardDeleteThread(threadId)
      })));
      sendOk(response, {
        ok: true,
        results,
        deletedCount: results.filter((result) => result.ok).length
      });
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to delete threads"));
    }
  });

  app.post("/api/threads/:threadId/trash", (request, response) => {
    const moved = storage.moveThreadToTrash(request.params.threadId);
    if (!moved) {
      sendError(response, 404, "not_found", "Thread not found or already in trash");
      return;
    }

    sendOk(response, { ok: true });
  });

  app.post("/api/threads/:threadId/restore", (request, response) => {
    const restored = storage.restoreThread(request.params.threadId);
    if (!restored) {
      sendError(response, 404, "not_found", "Thread not found in trash");
      return;
    }

    sendOk(response, { ok: true });
  });

  app.patch("/api/threads/:threadId", (request, response) => {
    try {
      const thread = storage.renameThread(request.params.threadId, request.body?.title);
      if (!thread) {
        sendError(response, 404, "not_found", "Thread not found");
        return;
      }

      sendOk(response, { thread });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to rename thread"));
    }
  });

  app.patch("/api/threads/:threadId/task-brief", (request, response) => {
    try {
      const saved = storage.saveTaskBrief(request.params.threadId, request.body?.brief, request.body?.revision);
      if (!saved) {
        sendError(response, 404, "not_found", "Thread not found");
        return;
      }

      sendOk(response, saved);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to save Task Brief"));
    }
  });

  app.patch("/api/threads/:threadId/model", (request, response) => {
    try {
      const configuredModelApiId = safeId(request.body?.configuredModelApiId);
      const thread = storage.setThreadModelConfig(request.params.threadId, configuredModelApiId ?? undefined);
      if (!thread) return sendError(response, 404, "not_found", "Thread not found");
      sendOk(response, { thread });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to select conversation model"));
    }
  });

  app.post("/api/threads/:threadId/context-reset", (request, response) => {
    const thread = storage.resetThreadContext(request.params.threadId);
    if (!thread) return sendError(response, 404, "not_found", "Thread not found");
    sendOk(response, { thread, contextResetAt: thread.contextResetAt });
  });

  app.patch("/api/threads/:threadId/output-versions/:versionId/context", (request, response) => {
    if (typeof request.body?.included !== "boolean") {
      return sendError(response, 400, "bad_request", "included must be a boolean");
    }
    const updated = storage.setOutputVersionProjectContext(request.params.threadId, request.params.versionId, request.body.included);
    if (!updated) return sendError(response, 404, "not_found", "Output version not found");
    sendOk(response, { ok: true, included: request.body.included });
  });

  app.delete("/api/threads/:threadId", async (request, response) => {
    try {
      const deleted = await storage.hardDeleteThread(request.params.threadId);
      if (!deleted) {
        sendError(response, 404, "not_found", "Thread must be in trash before hard delete");
        return;
      }

      sendOk(response, { ok: true });
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to delete thread"));
    }
  });

  app.get("/api/threads/:threadId/messages", (request, response) => {
    sendOk(response, { messages: storage.listMessages(request.params.threadId) });
  });

  app.get("/api/threads/:threadId/state", async (request, response) => {
    let thread = storage.getThread(request.params.threadId);
    if (!thread) {
      sendError(response, 404, "not_found", "Thread not found");
      return;
    }

    const projectId = thread.projectId;
    const configuredModelApiId = await resolveModelId([
      thread.configuredModelApiId,
      storage.listProjectThreads(projectId).find((candidate) => candidate.configuredModelApiId)?.configuredModelApiId,
      storage.listRecentThreads().find((candidate) => candidate.configuredModelApiId)?.configuredModelApiId
    ]);
    if (configuredModelApiId && thread.configuredModelApiId !== configuredModelApiId) {
      thread = storage.setThreadModelConfig(thread.id, configuredModelApiId) ?? thread;
    }
    const project = storage.listProjects().find((candidate) => candidate.id === projectId);
    storage.migrateCanvasWorkflowRoleNodes(projectId);
    const plans = storage.listPlanRuns(request.params.threadId);
    const toolEvents = storage.listToolEvents(request.params.threadId);
    const outputVersions = storage.listOutputVersions(request.params.threadId);
    const latestRunId = outputVersions[0]?.runId;
    const runTimelineSourceEvents = latestRunId
      ? toolEvents.filter((event) => event.runId === latestRunId)
      : toolEvents;
    sendOk(response, {
      thread,
      project,
      messages: storage.listMessages(request.params.threadId),
      projectBrief: storage.getProjectBrief(projectId),
      taskBrief: storage.getTaskBrief(request.params.threadId),
      outputVersions,
      toolEvents,
      runTimelineEvents: runTimelineSourceEvents.map(timelineEventFromToolEvent).filter((event): event is NonNullable<typeof event> => Boolean(event)),
      canvasNodes: storage.listCanvasNodes(projectId),
      canvasEdges: storage.listCanvasEdges(projectId),
      canvasObjects: storage.listCanvasObjects(projectId),
      canvasWriteRequests: storage.listCanvasWriteRequests(projectId, "pending"),
      canvasWriteSuggestions: storage.listCanvasWriteSuggestions(request.params.threadId),
      canvasWorkflow: storage.getCanvasWorkflow(projectId),
      canvasWorkflowSuggestions: storage.listCanvasWorkflowSuggestions(projectId),
      plans,
      planActivities: plans.flatMap((plan) => storage.listPlanActivities(request.params.threadId, plan.id))
    });
  });
}

function parseThreadIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids = value.map((item) => safeId(item)).filter((item): item is string => Boolean(item));
  return ids.length === value.length ? [...new Set(ids)] : undefined;
}
