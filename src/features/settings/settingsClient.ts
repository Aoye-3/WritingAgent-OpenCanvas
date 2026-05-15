import type { SettingsSaveRequest, SettingsStatus, SettingsValidationResponse } from "./types";
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
