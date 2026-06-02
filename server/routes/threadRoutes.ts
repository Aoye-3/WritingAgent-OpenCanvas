import type { Express } from "express";
import { agentCards } from "../agentCards.js";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";
import { randomThreadId, safeId } from "../utils/ids.js";

type ThreadRouteDeps = {
  storage: SQLiteStorageRepository;
  agentRuntime: AgentRuntimeAdapter;
};

export function registerThreadRoutes(app: Express, { storage, agentRuntime }: ThreadRouteDeps) {
  app.get("/api/threads/recent", (_request, response) => {
    sendOk(response, { threads: storage.listRecentThreads() });
  });

  app.post("/api/threads", async (request, response) => {
    const agentCard = agentRuntime.resolveAgentCard(String(request.body?.agentCardId ?? agentCards[0].id));
    const threadId = safeId(request.body?.threadId) ?? randomThreadId();

    try {
      await storage.ensureThread(threadId, agentCard.id);
      sendOk(response, { threadId, agentCardId: agentCard.id });
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

  app.patch("/api/threads/:threadId/inputs", (request, response) => {
    try {
      const structuredValues = storage.saveThreadInputValues(request.params.threadId, request.body?.structuredValues);
      if (!structuredValues) {
        sendError(response, 404, "not_found", "Thread not found");
        return;
      }

      sendOk(response, { structuredValues });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to save structured inputs"));
    }
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

  app.get("/api/threads/:threadId/state", (request, response) => {
    const thread = storage.getThread(request.params.threadId);
    if (!thread) {
      sendError(response, 404, "not_found", "Thread not found");
      return;
    }

    storage.migrateCanvasWorkflowRoleNodes(request.params.threadId);
    sendOk(response, {
      thread,
      messages: storage.listMessages(request.params.threadId),
      structuredValues: storage.getThreadInputValues(request.params.threadId),
      outputVersions: storage.listOutputVersions(request.params.threadId),
      toolEvents: storage.listToolEvents(request.params.threadId),
      canvasNodes: storage.listCanvasNodes(request.params.threadId),
      canvasEdges: storage.listCanvasEdges(request.params.threadId),
      canvasWriteRequests: storage.listCanvasWriteRequests(request.params.threadId, "pending"),
      canvasWorkflow: storage.getCanvasWorkflow(request.params.threadId),
      canvasWorkflowSuggestions: storage.listCanvasWorkflowSuggestions(request.params.threadId)
    });
  });
}

function parseThreadIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids = value.map((item) => safeId(item)).filter((item): item is string => Boolean(item));
  return ids.length === value.length ? [...new Set(ids)] : undefined;
}
