import type {
  AgentBackendConfigOverview,
  AgentBackendRuntimeStatus,
  SettingsSaveRequest,
  SettingsStatus,
  SettingsValidationResponse
} from "./types";
import { apiGet, apiPost } from "../../shared/apiClient";

export async function getSettingsStatus(): Promise<SettingsStatus> {
  return apiGet<SettingsStatus>("/api/settings/status");
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
