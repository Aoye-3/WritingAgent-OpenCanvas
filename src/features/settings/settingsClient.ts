import type {
  AgentBackendConfigOverview,
  AgentBackendRuntimeStatus,
  CanvasSettings,
  ProjectRuntimeSettings,
  SettingsSaveRequest,
  SettingsStatus,
  SettingsValidationResponse
} from "./types";
import { apiGet, apiPost, apiPut } from "../../shared/apiClient";

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
  return apiGet<AgentBackendRuntimeStatus>("/api/agent-runtime/status");
}

export async function getAgentBackendConfigOverview(): Promise<AgentBackendConfigOverview> {
  return apiGet<AgentBackendConfigOverview>("/api/agent-runtime/config");
}

export async function getCanvasSettings(): Promise<CanvasSettings> {
  return apiGet<CanvasSettings>("/api/settings/canvas");
}

export async function saveCanvasSettings(payload: CanvasSettings): Promise<CanvasSettings> {
  return apiPut<CanvasSettings>("/api/settings/canvas", payload);
}

export async function getProjectRuntimeSettings(projectId: string): Promise<ProjectRuntimeSettings> {
  const response = await apiGet<{ settings: ProjectRuntimeSettings }>(`/api/projects/${projectId}/runtime-settings`);
  return response.settings;
}

export async function saveProjectRuntimeSettings(projectId: string, payload: ProjectRuntimeSettings): Promise<ProjectRuntimeSettings> {
  const response = await apiPut<{ settings: ProjectRuntimeSettings }>(`/api/projects/${projectId}/runtime-settings`, payload);
  return response.settings;
}
