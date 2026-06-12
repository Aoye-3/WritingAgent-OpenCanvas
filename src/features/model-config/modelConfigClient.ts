import { apiDelete, apiGet, apiPost, apiPut } from "../../shared/apiClient";
import type {
  ConfiguredModelApiListResponse,
  ConfiguredModelApiSaveRequest,
  ConfiguredModelApiSummary,
  ProviderApiConfigListResponse,
  ProviderApiConfigSaveRequest,
  ProviderApiConfigSummary,
  ProviderModelsResponse,
  ProviderReference
} from "./types";

export async function getProviderReferences(): Promise<{ providers: ProviderReference[] }> {
  return apiGet<{ providers: ProviderReference[] }>("/api/settings/provider-references");
}

export async function getProviderModels(payload: { providerId: string; apiKey?: string; baseURL?: string }): Promise<ProviderModelsResponse> {
  return apiPost<ProviderModelsResponse>("/api/settings/provider-models", payload);
}

export async function getProviderApiConfigs(): Promise<ProviderApiConfigListResponse> {
  return apiGet<ProviderApiConfigListResponse>("/api/settings/provider-api-configs");
}

export async function getConfiguredModelApis(): Promise<ConfiguredModelApiListResponse> {
  return apiGet<ConfiguredModelApiListResponse>("/api/settings/configured-model-apis");
}

export async function getConfiguredModelApi(configId: string): Promise<ConfiguredModelApiSummary> {
  return apiGet<ConfiguredModelApiSummary>(`/api/settings/configured-model-apis/${encodeURIComponent(configId)}`);
}

export async function createConfiguredModelApi(payload: ConfiguredModelApiSaveRequest): Promise<ConfiguredModelApiSummary> {
  return apiPost<ConfiguredModelApiSummary>("/api/settings/configured-model-apis", payload);
}

export async function saveConfiguredModelApi(configId: string, payload: ConfiguredModelApiSaveRequest): Promise<ConfiguredModelApiSummary> {
  return apiPut<ConfiguredModelApiSummary>(`/api/settings/configured-model-apis/${encodeURIComponent(configId)}`, payload);
}

export async function deleteConfiguredModelApi(configId: string): Promise<{ ok: boolean; activeConfigId?: string }> {
  return apiDelete<{ ok: boolean; activeConfigId?: string }>(`/api/settings/configured-model-apis/${encodeURIComponent(configId)}`);
}

export type ModelRuntimeSyncEntry = {
  configuredModelApiId: string;
  status: "synced" | "failed" | "unsupported" | "disabled";
  lastAttemptAt: string;
  errorMessage?: string;
};

export async function getModelRuntimeSyncStatus(): Promise<{ models: ModelRuntimeSyncEntry[] }> {
  return apiGet<{ models: ModelRuntimeSyncEntry[] }>("/api/settings/model-runtime-sync-status");
}

export async function retryModelRuntimeSync(): Promise<{ models: ModelRuntimeSyncEntry[] }> {
  return apiPost<{ models: ModelRuntimeSyncEntry[] }>("/api/settings/model-runtime-sync/retry");
}

export async function getProviderApiConfig(providerId: string): Promise<ProviderApiConfigSummary> {
  return apiGet<ProviderApiConfigSummary>(`/api/settings/provider-api-configs/${encodeURIComponent(providerId)}`);
}

export async function saveProviderApiConfig(providerId: string, payload: ProviderApiConfigSaveRequest): Promise<ProviderApiConfigSummary> {
  return apiPut<ProviderApiConfigSummary>(`/api/settings/provider-api-configs/${encodeURIComponent(providerId)}`, payload);
}

export async function deleteProviderApiConfig(providerId: string): Promise<{ ok: boolean; activeProviderId?: string }> {
  return apiDelete<{ ok: boolean; activeProviderId?: string }>(`/api/settings/provider-api-configs/${encodeURIComponent(providerId)}`);
}
