import type { Express } from "express";
import type { KnowledgeService } from "../knowledge/service.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type KnowledgeRouteDeps = {
  knowledgeService: KnowledgeService;
};

export function registerKnowledgeRoutes(app: Express, { knowledgeService }: KnowledgeRouteDeps) {
  app.get("/api/knowledge/bases", async (_request, response) => {
    sendOk(response, { bases: await knowledgeService.listBases() });
  });

  app.post("/api/knowledge/bases", async (request, response) => {
    try {
      sendOk(response, { base: await knowledgeService.createBase(request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create knowledge base"));
    }
  });

  app.get("/api/knowledge/bases/:baseId", async (request, response) => {
    const base = await knowledgeService.getBase(request.params.baseId);
    if (!base) {
      sendError(response, 404, "not_found", "Knowledge base was not found");
      return;
    }
    sendOk(response, { base });
  });

  app.patch("/api/knowledge/bases/:baseId", async (request, response) => {
    try {
      const base = await knowledgeService.updateBase(request.params.baseId, request.body ?? {});
      if (!base) {
        sendError(response, 404, "not_found", "Knowledge base was not found");
        return;
      }
      sendOk(response, { base });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update knowledge base"));
    }
  });

  app.delete("/api/knowledge/bases/:baseId", async (request, response) => {
    await knowledgeService.deleteBase(request.params.baseId);
    sendOk(response, { ok: true });
  });

  app.post("/api/knowledge/bases/:baseId/items", async (request, response) => {
    try {
      sendOk(response, { item: await knowledgeService.addItem(request.params.baseId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to index knowledge item"));
    }
  });

  app.delete("/api/knowledge/bases/:baseId/items/:itemId", async (request, response) => {
    const deleted = await knowledgeService.deleteItem(request.params.baseId, request.params.itemId);
    if (!deleted) {
      sendError(response, 404, "not_found", "Knowledge item was not found");
      return;
    }
    sendOk(response, { ok: true });
  });

  app.post("/api/knowledge/search", async (request, response) => {
    try {
      sendOk(response, {
        results: await knowledgeService.search({
          query: readString(request.body?.query),
          baseIds: readStringArray(request.body?.baseIds),
          limit: readNumber(request.body?.limit),
          threshold: readNumber(request.body?.threshold)
        })
      });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to search knowledge bases"));
    }
  });

  app.post("/api/knowledge/bases/:baseId/reindex", async (request, response) => {
    try {
      sendOk(response, { base: await knowledgeService.reindexBase(request.params.baseId) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to reindex knowledge base"));
    }
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
