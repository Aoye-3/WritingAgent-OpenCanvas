import type { Express } from "express";
import { parseSettingsPayload } from "../contracts/settings.js";
import {
  createConfiguredModelApi,
  deleteConfiguredModelApi,
  deleteProviderApiConfig,
  getConfiguredModelApiSummary,
  getProviderApiConfigSummary,
  getProviderReferences,
  listConfiguredModelApiSummaries,
  listProviderApiConfigSummaries,
  listProviderModels,
  saveConfiguredModelApi,
  saveProviderApiConfig
} from "../domains/model-config/index.js";
import { getSettingsStatus, saveSettings, validateSettings } from "../services/settingsService.js";
import { scheduleDevServerShutdown } from "../services/devServerControl.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerSettingsRoutes(app: Express) {
  app.get("/api/settings/status", async (_request, response) => {
    sendOk(response, await getSettingsStatus());
  });

  app.get("/api/settings/provider-references", (_request, response) => {
    sendOk(response, { providers: getProviderReferences() });
  });

  app.get("/api/settings/provider-api-configs", async (_request, response) => {
    sendOk(response, await listProviderApiConfigSummaries());
  });

  app.get("/api/settings/configured-model-apis", async (_request, response) => {
    sendOk(response, await listConfiguredModelApiSummaries());
  });

  app.get("/api/settings/configured-model-apis/:configId", async (request, response) => {
    try {
      sendOk(response, await getConfiguredModelApiSummary(request.params.configId));
    } catch (error) {
      sendError(response, 404, "not_found", errorMessage(error, "Configured model API was not found"));
    }
  });

  app.post("/api/settings/configured-model-apis", async (request, response) => {
    try {
      sendOk(response, await createConfiguredModelApi(parseConfiguredModelApiPayload(request.body)));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to create configured model API"));
    }
  });

  app.put("/api/settings/configured-model-apis/:configId", async (request, response) => {
    try {
      sendOk(response, await saveConfiguredModelApi(request.params.configId, parseConfiguredModelApiPayload(request.body)));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to save configured model API"));
    }
  });

  app.delete("/api/settings/configured-model-apis/:configId", async (request, response) => {
    try {
      sendOk(response, await deleteConfiguredModelApi(request.params.configId));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to delete configured model API"));
    }
  });

  app.get("/api/settings/provider-api-configs/:providerId", async (request, response) => {
    sendOk(response, await getProviderApiConfigSummary(request.params.providerId));
  });

  app.put("/api/settings/provider-api-configs/:providerId", async (request, response) => {
    try {
      sendOk(response, await saveProviderApiConfig(request.params.providerId, parseProviderApiConfigPayload(request.body)));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to save provider API config"));
    }
  });

  app.delete("/api/settings/provider-api-configs/:providerId", async (request, response) => {
    try {
      sendOk(response, await deleteProviderApiConfig(request.params.providerId));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Unable to delete provider API config"));
    }
  });

  app.post("/api/settings/provider-models", async (request, response) => {
    sendOk(response, await listProviderModels(parseProviderModelsPayload(request.body)));
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

function parseProviderModelsPayload(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  return {
    providerId: typeof body.providerId === "string" ? body.providerId : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    baseURL: typeof body.baseURL === "string" ? body.baseURL : undefined
  };
}

function parseProviderApiConfigPayload(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  return {
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    baseURL: typeof body.baseURL === "string" ? body.baseURL : undefined,
    defaultModel: typeof body.defaultModel === "string" ? body.defaultModel : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    confirmLocalKeyWrite: body.confirmLocalKeyWrite === true
  };
}

function parseConfiguredModelApiPayload(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  return {
    providerId: typeof body.providerId === "string" ? body.providerId : undefined,
    modelId: typeof body.modelId === "string" ? body.modelId : undefined,
    modelName: typeof body.modelName === "string" ? body.modelName : undefined,
    modelType: typeof body.modelType === "string" ? body.modelType : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    baseURL: typeof body.baseURL === "string" ? body.baseURL : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    confirmLocalKeyWrite: body.confirmLocalKeyWrite === true
  };
}
