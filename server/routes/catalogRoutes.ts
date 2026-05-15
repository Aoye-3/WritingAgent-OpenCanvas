import type { Express } from "express";
import { getSkillCatalog, getToolCatalog } from "../services/agentDefinitionService.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerCatalogRoutes(app: Express) {
  app.get("/api/tools/catalog", (_request, response) => {
    sendOk(response, { tools: getToolCatalog() });
  });

  app.get("/api/skills/catalog", async (_request, response) => {
    try {
      sendOk(response, { skills: await getSkillCatalog() });
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to load skill catalog"));
    }
  });
}
