import type { Express } from "express";
import {
  createProjectSkillFolder,
  deleteProjectSkillFolder,
  loadPublicSkillFolders,
  moveProjectSkillToFolder,
  renameProjectSkillFolder
} from "../skillLoader.js";
import { getSkillCatalog, getToolCatalog } from "../services/agentDefinitionService.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerCatalogRoutes(app: Express) {
  app.get("/api/tools/catalog", (_request, response) => {
    sendOk(response, { tools: getToolCatalog() });
  });

  app.get("/api/skills/catalog", async (_request, response) => {
    try {
      sendOk(response, { skills: await getSkillCatalog(), folders: await loadPublicSkillFolders() });
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to load skill catalog"));
    }
  });

  app.post("/api/skills/folders", async (request, response) => {
    try {
      const folderId = readString(request.body?.folderId);
      if (!folderId) throw new Error("folderId is required");
      await createProjectSkillFolder(folderId);
      sendOk(response, { skills: await getSkillCatalog(), folders: await loadPublicSkillFolders() });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create skill folder"));
    }
  });

  app.patch("/api/skills/folders/:folderId", async (request, response) => {
    try {
      const folderId = readString(request.body?.folderId);
      if (!folderId) throw new Error("folderId is required");
      await renameProjectSkillFolder(request.params.folderId, folderId);
      sendOk(response, { skills: await getSkillCatalog(), folders: await loadPublicSkillFolders() });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to rename skill folder"));
    }
  });

  app.delete("/api/skills/folders/:folderId", async (request, response) => {
    try {
      await deleteProjectSkillFolder(request.params.folderId);
      sendOk(response, { skills: await getSkillCatalog(), folders: await loadPublicSkillFolders() });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to delete skill folder"));
    }
  });

  app.patch("/api/skills/:skillRef/folder", async (request, response) => {
    try {
      const folderId = readString(request.body?.folderId);
      if (!folderId) throw new Error("folderId is required");
      await moveProjectSkillToFolder(request.params.skillRef, folderId);
      sendOk(response, { skills: await getSkillCatalog(), folders: await loadPublicSkillFolders() });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to move skill"));
    }
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
