import type { Express } from "express";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type CanvasRouteDeps = {
  storage: SQLiteStorageRepository;
};

export function registerCanvasRoutes(app: Express, { storage }: CanvasRouteDeps) {
  app.get("/api/threads/:threadId/canvas", (request, response) => {
    const thread = storage.getThread(request.params.threadId);
    if (!thread) {
      sendError(response, 404, "not_found", "Thread not found");
      return;
    }

    sendOk(response, {
      nodes: storage.listCanvasNodes(request.params.threadId),
      writeRequests: storage.listCanvasWriteRequests(request.params.threadId, "pending")
    });
  });

  app.post("/api/threads/:threadId/canvas/nodes", (request, response) => {
    try {
      sendOk(response, { node: storage.createCanvasNode(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas node"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-requests", (request, response) => {
    try {
      sendOk(response, { request: storage.createCanvasWriteRequest(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas write request"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/nodes/:nodeId", (request, response) => {
    try {
      const node = storage.updateCanvasNode(request.params.threadId, request.params.nodeId, request.body ?? {});
      if (!node) {
        sendError(response, 404, "not_found", "Canvas node not found");
        return;
      }
      sendOk(response, { node });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas node"));
    }
  });

  app.delete("/api/threads/:threadId/canvas/nodes/:nodeId", (request, response) => {
    try {
      const deleted = storage.deleteCanvasNode(request.params.threadId, request.params.nodeId);
      if (!deleted) {
        sendError(response, 404, "not_found", "Canvas node not found");
        return;
      }
      sendOk(response, { ok: true });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to delete canvas node"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-requests/:requestId/approve", (request, response) => {
    try {
      const result = storage.approveCanvasWriteRequest(request.params.threadId, request.params.requestId);
      if (!result) {
        sendError(response, 404, "not_found", "Pending write request not found");
        return;
      }
      sendOk(response, result);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to approve write request"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-requests/:requestId/reject", (request, response) => {
    try {
      const requestResult = storage.rejectCanvasWriteRequest(request.params.threadId, request.params.requestId);
      if (!requestResult) {
        sendError(response, 404, "not_found", "Pending write request not found");
        return;
      }
      sendOk(response, { request: requestResult });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to reject write request"));
    }
  });
}
