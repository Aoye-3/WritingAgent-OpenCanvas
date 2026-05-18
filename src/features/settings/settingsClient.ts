import type { DeerFlowConfigOverview, DeerFlowRuntimeStatus, SettingsSaveRequest, SettingsStatus, SettingsValidationResponse } from "./types";
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

export async function getDeerFlowRuntimeStatus(): Promise<DeerFlowRuntimeStatus> {
  return apiGet<DeerFlowRuntimeStatus>("/api/deerflow/status");
}

export async function getDeerFlowConfigOverview(): Promise<DeerFlowConfigOverview> {
  return apiGet<DeerFlowConfigOverview>("/api/deerflow/config");
}
