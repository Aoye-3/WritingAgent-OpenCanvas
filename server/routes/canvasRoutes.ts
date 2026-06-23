import type { Express } from "express";
import type { CanvasDomainService } from "../domains/canvas/index.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";
import type { MarkdownOutputPreview } from "../services/threadOutputPreview.js";

type CanvasRouteDeps = {
  canvasService: CanvasDomainService;
  readMarkdownOutputPreview?: (threadId: string, virtualPath: string) => Promise<MarkdownOutputPreview>;
};

export function registerCanvasRoutes(app: Express, { canvasService, readMarkdownOutputPreview }: CanvasRouteDeps) {
  const projectIdForThread = (threadId: string) => canvasService.projectIdForThread(threadId);
  app.get("/api/threads/:threadId/canvas", (request, response) => {
    try {
      const canvas = canvasService.getCanvas(projectIdForThread(request.params.threadId));
      if (!canvas) return sendError(response, 404, "not_found", "Project not found");
      sendOk(response, canvas);
    } catch (error) {
      sendError(response, 404, "not_found", errorMessage(error, "Thread not found"));
    }
  });

  app.get("/api/threads/:threadId/canvas/document-preview", async (request, response) => {
    if (!readMarkdownOutputPreview) {
      sendError(response, 404, "not_found", "Markdown preview is not available");
      return;
    }
    try {
      const virtualPath = typeof request.query.path === "string" ? request.query.path : "";
      if (!virtualPath) throw new Error("Markdown preview path is required");
      sendOk(response, { document: await readMarkdownOutputPreview(request.params.threadId, virtualPath) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to read Markdown preview"));
    }
  });

  app.put("/api/threads/:threadId/canvas/workflow", (request, response) => {
    try {
      sendOk(response, { workflow: canvasService.updateWorkflow(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas workflow"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/nodes/:nodeId/workflow", (request, response) => {
    try {
      const node = canvasService.updateNodeWorkflow(projectIdForThread(request.params.threadId), request.params.nodeId, request.body ?? {});
      if (!node) {
        sendError(response, 404, "not_found", "Canvas node not found");
        return;
      }
      sendOk(response, { node });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas node workflow"));
    }
  });

  app.post("/api/threads/:threadId/canvas/suggestions", (request, response) => {
    try {
      sendOk(response, { suggestion: canvasService.createSuggestion(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas workflow suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/suggestions/:suggestionId/accept", (request, response) => {
    try {
      const suggestion = canvasService.acceptSuggestion(projectIdForThread(request.params.threadId), request.params.suggestionId);
      if (!suggestion) {
        sendError(response, 404, "not_found", "Canvas workflow suggestion not found");
        return;
      }
      sendOk(response, { suggestion });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to accept canvas workflow suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/suggestions/:suggestionId/ignore", (request, response) => {
    try {
      const suggestion = canvasService.ignoreSuggestion(projectIdForThread(request.params.threadId), request.params.suggestionId);
      if (!suggestion) {
        sendError(response, 404, "not_found", "Canvas workflow suggestion not found");
        return;
      }
      sendOk(response, { suggestion });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to ignore canvas workflow suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/suggestions/:suggestionId/convert-to-node", (request, response) => {
    try {
      const result = canvasService.convertSuggestionToNode(projectIdForThread(request.params.threadId), request.params.suggestionId, request.body ?? {});
      if (!result) {
        sendError(response, 404, "not_found", "Canvas workflow suggestion not found");
        return;
      }
      sendOk(response, result);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to convert canvas workflow suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/nodes", (request, response) => {
    try {
      sendOk(response, { node: canvasService.createNode(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas node"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-requests", (request, response) => {
    try {
      sendOk(response, { request: canvasService.createWriteRequest(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas write request"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-suggestions/:suggestionId/accept", (request, response) => {
    try {
      const suggestion = canvasService.acceptWriteSuggestion(request.params.threadId, request.params.suggestionId);
      if (!suggestion) return sendError(response, 404, "not_found", "Canvas write suggestion not found");
      sendOk(response, { suggestion });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to accept Canvas write suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-suggestions/:suggestionId/dismiss", (request, response) => {
    try {
      const suggestion = canvasService.dismissWriteSuggestion(request.params.threadId, request.params.suggestionId);
      if (!suggestion) return sendError(response, 404, "not_found", "Canvas write suggestion not found");
      sendOk(response, { suggestion });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to dismiss Canvas write suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/edges", (request, response) => {
    try {
      sendOk(response, { edge: canvasService.createEdge(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas edge"));
    }
  });

  app.delete("/api/threads/:threadId/canvas/edges/:edgeId", (request, response) => {
    try {
      const deleted = canvasService.deleteEdge(projectIdForThread(request.params.threadId), request.params.edgeId);
      if (!deleted) {
        sendError(response, 404, "not_found", "Canvas edge not found");
        return;
      }
      sendOk(response, { ok: true });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to delete canvas edge"));
    }
  });

  app.post("/api/threads/:threadId/canvas/objects", (request, response) => {
    try {
      sendOk(response, { object: canvasService.createObject(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas object"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/objects/:objectId", (request, response) => {
    try {
      const object = canvasService.updateObject(projectIdForThread(request.params.threadId), request.params.objectId, request.body ?? {});
      if (!object) return sendError(response, 404, "not_found", "Canvas object not found");
      sendOk(response, { object });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas object"));
    }
  });

  app.delete("/api/threads/:threadId/canvas/objects/:objectId", async (request, response) => {
    try {
      if (!await canvasService.deleteObject(projectIdForThread(request.params.threadId), request.params.objectId)) {
        return sendError(response, 404, "not_found", "Canvas object not found");
      }
      sendOk(response, { ok: true });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to delete canvas object"));
    }
  });

  app.post("/api/threads/:threadId/canvas/assets", async (request, response) => {
    try {
      sendOk(response, { object: await canvasService.createAsset(projectIdForThread(request.params.threadId), request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to upload canvas asset"));
    }
  });

  app.get("/api/threads/:threadId/canvas/assets/:objectId/content", async (request, response) => {
    try {
      const content = await canvasService.readAsset(projectIdForThread(request.params.threadId), request.params.objectId);
      if (!content) return sendError(response, 404, "not_found", "Canvas asset not found");
      response.type(content.extension || "application/octet-stream").send(content.content);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to read canvas asset"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/node-positions", (request, response) => {
    try {
      const updates = Array.isArray(request.body?.updates) ? request.body.updates : undefined;
      if (!updates) throw new Error("Canvas node position updates are required");
      const nodes = canvasService.updateNodePositions(projectIdForThread(request.params.threadId), updates);
      if (!nodes) {
        sendError(response, 404, "not_found", "Canvas node not found");
        return;
      }
      sendOk(response, { nodes });
    } catch (error) {
      if (/not found/i.test(errorMessage(error, ""))) {
        sendError(response, 404, "not_found", "Canvas node not found");
        return;
      }
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas node positions"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/nodes/:nodeId", (request, response) => {
    try {
      const node = canvasService.updateNode(projectIdForThread(request.params.threadId), request.params.nodeId, request.body ?? {});
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
      const deleted = canvasService.deleteNode(projectIdForThread(request.params.threadId), request.params.nodeId);
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
      const result = canvasService.approveWriteRequest(projectIdForThread(request.params.threadId), request.params.requestId);
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
      const requestResult = canvasService.rejectWriteRequest(projectIdForThread(request.params.threadId), request.params.requestId);
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
