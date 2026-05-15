import type { getProviderProfile } from "../providerRuntime.js";
import type { Provider, ProviderId } from "../types.js";

export type SettingsPayload = {
  providerId?: ProviderId;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  systemPrompt?: string;
  confirmLocalKeyWrite?: boolean;
};

export type SettingsStatus = {
  keyConfigured: boolean;
  providerId: ProviderId;
  providerLabel: string;
  baseURL: string;
  model: string;
  systemPrompt: string;
  apiHealth: "online" | "offline";
  provider: Provider;
  capabilities: ReturnType<typeof getProviderProfile>["capabilities"];
  modelAliases?: ReturnType<typeof getProviderProfile>["modelAliases"];
  lastValidated?: string;
  lastError?: string;
};

export function parseSettingsPayload(value: unknown): SettingsPayload {
  if (!value || typeof value !== "object") {
    return {};
  }

  const body = value as Record<string, unknown>;
  return {
    providerId: readProviderId(body.providerId),
    apiKey: readString(body.apiKey),
    baseURL: readString(body.baseURL),
    model: readString(body.model),
    systemPrompt: readString(body.systemPrompt),
    confirmLocalKeyWrite: body.confirmLocalKeyWrite === true
  };
}

function readProviderId(value: unknown): ProviderId | undefined {
  return value === "deepseek" || value === "openai" || value === "openai-compatible" ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
