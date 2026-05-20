import type {
  AgentBackendConfigOverview,
  AgentBackendRuntimeStatus,
  ConfiguredModelApiListResponse,
  ConfiguredModelApiSaveRequest,
  ConfiguredModelApiSummary,
  ProviderApiConfigListResponse,
  ProviderApiConfigSaveRequest,
  ProviderApiConfigSummary,
  ProviderModelsResponse,
  ProviderReference,
  SettingsSaveRequest,
  SettingsStatus,
  SettingsValidationResponse
} from "./types";
import { apiDelete, apiGet, apiPost, apiPut } from "../../shared/apiClient";

export async function getSettingsStatus(): Promise<SettingsStatus> {
  return apiGet<SettingsStatus>("/api/settings/status");
}

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

export async function getProviderApiConfig(providerId: string): Promise<ProviderApiConfigSummary> {
  return apiGet<ProviderApiConfigSummary>(`/api/settings/provider-api-configs/${encodeURIComponent(providerId)}`);
}

export async function saveProviderApiConfig(providerId: string, payload: ProviderApiConfigSaveRequest): Promise<ProviderApiConfigSummary> {
  return apiPut<ProviderApiConfigSummary>(`/api/settings/provider-api-configs/${encodeURIComponent(providerId)}`, payload);
}

export async function deleteProviderApiConfig(providerId: string): Promise<{ ok: boolean; activeProviderId?: string }> {
  return apiDelete<{ ok: boolean; activeProviderId?: string }>(`/api/settings/provider-api-configs/${encodeURIComponent(providerId)}`);
}

export async function validateSettings(payload: SettingsSaveRequest): Promise<SettingsValidationResponse> {
  return apiPost<SettingsValidationResponse>("/api/settings/validate", payload);
}

export async function saveSettings(payload: SettingsSaveRequest): Promise<SettingsStatus> {
  return apiPost<SettingsStatus>("/api/settings/save", payload);
}

export async function shutdownDevServer(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/api/settings/shutdown-dev-server");
}

export async function getAgentBackendRuntimeStatus(): Promise<AgentBackendRuntimeStatus> {
  return apiGet<AgentBackendRuntimeStatus>("/api/agent-backend/status");
}

export async function getAgentBackendConfigOverview(): Promise<AgentBackendConfigOverview> {
  return apiGet<AgentBackendConfigOverview>("/api/agent-backend/config");
}
