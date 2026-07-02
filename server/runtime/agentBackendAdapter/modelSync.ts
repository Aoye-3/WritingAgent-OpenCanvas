import { readProviderApiConfigStore, type ConfiguredModelApi } from "../../domains/model-config/index.js";
import { authenticatedAgentBackendFetch } from "./auth.js";
import { getAgentBackendRuntimeConfig } from "./config.js";
import { getProviderReference } from "../../../shared/modelReferences.js";

export type ModelRuntimeSyncStatus = "synced" | "failed" | "unsupported" | "disabled";

export type ModelRuntimeSyncEntry = {
  configuredModelApiId: string;
  status: ModelRuntimeSyncStatus;
  lastAttemptAt: string;
  errorMessage?: string;
};

type RuntimeModel = {
  name: string;
  display_name: string;
  description: string;
  use: "langchain_openai:ChatOpenAI";
  model: string;
  api_key?: string;
  base_url: string;
  supports_thinking: boolean;
  supports_reasoning_effort: boolean;
  supports_tool_choice_with_thinking: true | false | "unknown";
  when_thinking_enabled?: Record<string, unknown>;
  when_thinking_disabled?: Record<string, unknown>;
};

type SyncModel = Omit<ConfiguredModelApi, "providerId"> & { providerId: string };

export function createModelRuntimeSyncService(deps: {
  loadModels: () => Promise<SyncModel[]>;
  pushModels: (models: RuntimeModel[]) => Promise<{ count: number }>;
}) {
  const statuses = new Map<string, ModelRuntimeSyncEntry>();

  return {
    async sync() {
      const models = await deps.loadModels();
      const attemptedAt = new Date().toISOString();
      const supported: Array<{ config: SyncModel; runtime: RuntimeModel }> = [];

      for (const config of models) {
        if (!config.enabled || !config.apiKey?.trim() || !isChatModel(config.modelType)) {
          statuses.set(config.id, { configuredModelApiId: config.id, status: "disabled", lastAttemptAt: attemptedAt });
          continue;
        }
        if (!isOpenAiCompatibleProvider(config.providerId)) {
          statuses.set(config.id, {
            configuredModelApiId: config.id,
            status: "unsupported",
            lastAttemptAt: attemptedAt,
            errorMessage: `Provider ${config.providerId} is not supported by AgentBackend runtime sync.`
          });
          continue;
        }
        supported.push({ config, runtime: toRuntimeModel(config) });
      }

      try {
        const result = await deps.pushModels(supported.map((entry) => entry.runtime));
        for (const { config } of supported) {
          statuses.set(config.id, { configuredModelApiId: config.id, status: "synced", lastAttemptAt: attemptedAt });
        }
        return { synced: true, count: result.count };
      } catch {
        for (const { config } of supported) {
          statuses.set(config.id, {
            configuredModelApiId: config.id,
            status: "failed",
            lastAttemptAt: attemptedAt,
            errorMessage: "AgentBackend model synchronization failed."
          });
        }
        throw new Error("AgentBackend model synchronization failed.");
      }
    },
    getStatus() {
      return { models: [...statuses.values()].sort((a, b) => a.configuredModelApiId.localeCompare(b.configuredModelApiId)) };
    },
    isModelReady(configuredModelApiId: string) {
      return statuses.get(configuredModelApiId)?.status === "synced";
    }
  };
}

const modelRuntimeSyncService = createModelRuntimeSyncService({
  loadModels: async () => Object.values((await readProviderApiConfigStore()).configs),
  pushModels: pushConfiguredModels
});

export async function syncConfiguredModelsToAgentBackend() {
  return modelRuntimeSyncService.sync();
}

export function getModelRuntimeSyncStatus() {
  return modelRuntimeSyncService.getStatus();
}

export function isConfiguredModelRuntimeReady(configuredModelApiId: string) {
  return modelRuntimeSyncService.isModelReady(configuredModelApiId);
}

async function pushConfiguredModels(models: RuntimeModel[]) {
  const runtime = getAgentBackendRuntimeConfig();
  if (!runtime.enabled) throw new Error("AgentBackend is disabled");
  const response = await authenticatedAgentBackendFetch({
    config: runtime,
    path: "/api/models/runtime-sync",
    init: {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models })
    }
  });
  if (!response.ok) throw new Error(`AgentBackend model sync returned HTTP ${response.status}`);
  return { count: models.length };
}

function toRuntimeModel(config: SyncModel): RuntimeModel {
  const thinkingConfig = config.supportsThinking === true ? modelThinkingConfig() : undefined;
  return {
    name: config.id,
    display_name: config.modelName ?? config.modelId,
    description: `Synced from FacetWrite Model Config (${config.providerId})`,
    use: "langchain_openai:ChatOpenAI",
    model: config.modelId,
    api_key: config.apiKey,
    base_url: config.baseURL,
    supports_thinking: Boolean(thinkingConfig),
    supports_reasoning_effort: false,
    supports_tool_choice_with_thinking: providerToolChoiceThinkingSupport(config.providerId, config.modelId),
    ...(thinkingConfig ?? {})
  };
}

function providerToolChoiceThinkingSupport(providerId: string, modelId: string): RuntimeModel["supports_tool_choice_with_thinking"] {
  if (providerId === "deepseek" || modelId.toLowerCase().includes("deepseek")) return false;
  const normalized = modelId.toLowerCase();
  if (providerId === "moonshot" || normalized.includes("kimi") || normalized.includes("qwen")) return "unknown";
  return "unknown";
}

function modelThinkingConfig(): Pick<RuntimeModel, "when_thinking_enabled" | "when_thinking_disabled"> {
  return {
    when_thinking_enabled: {
      extra_body: {
        thinking: { type: "enabled" }
      }
    },
    when_thinking_disabled: {
      extra_body: {
        thinking: { type: "disabled" }
      }
    }
  };
}

function isOpenAiCompatibleProvider(providerId: string) {
  const provider = getProviderReference(providerId);
  return provider?.type === "openai" || provider?.type === "openai-compatible" || provider?.type === "new-api";
}

function isChatModel(modelType?: string) {
  const normalized = modelType?.toLowerCase();
  return !normalized || normalized === "chat" || normalized === "vision";
}
