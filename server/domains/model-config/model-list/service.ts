import { getProviderReference, getStaticModels, providerReferences } from "../../../../shared/modelReferences.js";
import { resolveProviderApiConfig } from "../providerApiConfigService.js";
import { modelFetchers, openAICompatibleFetcher } from "./fetchers.js";
import type { ProviderModelsPayload, ProviderModelsResult } from "./types.js";
import { safeErrorMessage } from "./utils.js";

const unsupportedRemoteTypes = new Set(["anthropic", "aws-bedrock", "azure-openai", "vertex-ai"]);
const noKeyModelListProviders = new Set(["aihubmix", "github", "openrouter", "ppio", "gateway", "ollama", "lmstudio", "ovms"]);

export function getProviderReferences() {
  return providerReferences;
}

export async function listProviderModels(payload: ProviderModelsPayload): Promise<ProviderModelsResult> {
  const providerId = payload.providerId?.trim() || "deepseek";
  const provider = getProviderReference(providerId);

  if (!provider) {
    return { providerId, models: [], source: "static", error: `Unknown provider: ${providerId}` };
  }

  const staticModels = getStaticModels(provider.id);
  if (unsupportedRemoteTypes.has(provider.type)) {
    return {
      providerId: provider.id,
      models: staticModels,
      source: "static",
      error: `${provider.name} does not expose a compatible remote model-list endpoint`
    };
  }

  const config = await resolveProviderApiConfig(provider.id);
  const apiKey = payload.apiKey?.trim() || config.apiKey?.trim() || "";
  const baseURL = payload.baseURL?.trim() || config.baseURL || provider.apiHost;

  if (!baseURL.trim()) {
    return {
      providerId: provider.id,
      models: staticModels,
      source: "static",
      error: `${provider.name} requires a Base URL before remote model listing`
    };
  }

  if (!apiKey && !noKeyModelListProviders.has(provider.id)) {
    return {
      providerId: provider.id,
      models: staticModels,
      source: "static",
      error: `${provider.name} API key is not configured for remote model listing`
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const fetcher = modelFetchers.find((candidate) => candidate.match(provider)) ?? openAICompatibleFetcher;
    try {
      const models = await fetcher.fetch({ apiKey, baseURL, provider, signal: controller.signal });
      return {
        providerId: provider.id,
        models: models.length > 0 ? models : staticModels,
        source: models.length > 0 ? "remote" : "static",
        error: models.length > 0 ? undefined : "Remote endpoint returned no models"
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      providerId: provider.id,
      models: staticModels,
      source: "static",
      error: safeErrorMessage(error)
    };
  }
}
