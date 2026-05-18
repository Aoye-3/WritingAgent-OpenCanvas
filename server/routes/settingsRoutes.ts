import type { Express } from "express";
import { parseSettingsPayload } from "../contracts/settings.js";
import { getSettingsStatus, saveSettings, validateSettings } from "../services/settingsService.js";
import { scheduleDevServerShutdown } from "../services/devServerControl.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerSettingsRoutes(app: Express) {
  app.get("/api/settings/status", (_request, response) => {
    sendOk(response, getSettingsStatus());
  });

  app.post("/api/settings/validate", async (request, response) => {
    sendOk(response, await validateSettings(parseSettingsPayload(request.body)));
  });

  app.post("/api/settings/save", async (request, response) => {
    try {
      sendOk(response, await saveSettings(parseSettingsPayload(request.body)));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to save settings"));
    }
  });

  app.post("/api/settings/shutdown-dev-server", (_request, response) => {
    try {
      scheduleDevServerShutdown();
      sendOk(response, { ok: true });
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to stop development server"));
    }
  });
}
