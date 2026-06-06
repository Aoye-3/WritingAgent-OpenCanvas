import type { Express } from "express";
import type { CanvasDomainService } from "../domains/canvas/index.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type CanvasRouteDeps = {
  canvasService: CanvasDomainService;
};

export function registerCanvasRoutes(app: Express, { canvasService }: CanvasRouteDeps) {
  app.get("/api/threads/:threadId/canvas", (request, response) => {
    const canvas = canvasService.getCanvas(request.params.threadId);
    if (!canvas) {
      sendError(response, 404, "not_found", "Thread not found");
      return;
    }

    sendOk(response, canvas);
  });

  app.put("/api/threads/:threadId/canvas/workflow", (request, response) => {
    try {
      sendOk(response, { workflow: canvasService.updateWorkflow(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas workflow"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/nodes/:nodeId/workflow", (request, response) => {
    try {
      const node = canvasService.updateNodeWorkflow(request.params.threadId, request.params.nodeId, request.body ?? {});
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
      sendOk(response, { suggestion: canvasService.createSuggestion(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas workflow suggestion"));
    }
  });

  app.post("/api/threads/:threadId/canvas/suggestions/:suggestionId/accept", (request, response) => {
    try {
      const suggestion = canvasService.acceptSuggestion(request.params.threadId, request.params.suggestionId);
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
      const suggestion = canvasService.ignoreSuggestion(request.params.threadId, request.params.suggestionId);
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
      const result = canvasService.convertSuggestionToNode(request.params.threadId, request.params.suggestionId, request.body ?? {});
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
      sendOk(response, { node: canvasService.createNode(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas node"));
    }
  });

  app.post("/api/threads/:threadId/canvas/write-requests", (request, response) => {
    try {
      sendOk(response, { request: canvasService.createWriteRequest(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas write request"));
    }
  });

  app.post("/api/threads/:threadId/canvas/edges", (request, response) => {
    try {
      sendOk(response, { edge: canvasService.createEdge(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas edge"));
    }
  });

  app.delete("/api/threads/:threadId/canvas/edges/:edgeId", (request, response) => {
    try {
      const deleted = canvasService.deleteEdge(request.params.threadId, request.params.edgeId);
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
      sendOk(response, { object: canvasService.createObject(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create canvas object"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/objects/:objectId", (request, response) => {
    try {
      const object = canvasService.updateObject(request.params.threadId, request.params.objectId, request.body ?? {});
      if (!object) return sendError(response, 404, "not_found", "Canvas object not found");
      sendOk(response, { object });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update canvas object"));
    }
  });

  app.delete("/api/threads/:threadId/canvas/objects/:objectId", async (request, response) => {
    try {
      if (!await canvasService.deleteObject(request.params.threadId, request.params.objectId)) {
        return sendError(response, 404, "not_found", "Canvas object not found");
      }
      sendOk(response, { ok: true });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to delete canvas object"));
    }
  });

  app.post("/api/threads/:threadId/canvas/assets", async (request, response) => {
    try {
      sendOk(response, { object: await canvasService.createAsset(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to upload canvas asset"));
    }
  });

  app.get("/api/threads/:threadId/canvas/assets/:objectId/content", async (request, response) => {
    try {
      const content = await canvasService.readAsset(request.params.threadId, request.params.objectId);
      if (!content) return sendError(response, 404, "not_found", "Canvas asset not found");
      response.type(content.extension || "application/octet-stream").send(content.content);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to read canvas asset"));
    }
  });

  app.patch("/api/threads/:threadId/canvas/nodes/:nodeId", (request, response) => {
    try {
      const node = canvasService.updateNode(request.params.threadId, request.params.nodeId, request.body ?? {});
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
      const deleted = canvasService.deleteNode(request.params.threadId, request.params.nodeId);
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
      const result = canvasService.approveWriteRequest(request.params.threadId, request.params.requestId);
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
      const requestResult = canvasService.rejectWriteRequest(request.params.threadId, request.params.requestId);
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
