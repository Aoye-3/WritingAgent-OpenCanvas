import type { DeerFlowConfigOverview, DeerFlowRuntimeStatus, SettingsStatus } from "./types";

export const fallbackStatus: SettingsStatus = {
  keyConfigured: false,
  providerId: "deepseek",
  providerLabel: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  systemPrompt: "You are FacetWrite's writing assistant. Generate clear, usable text from the user's prompt.",
  apiHealth: "offline",
  provider: "mock",
  capabilities: {
    chatCompletions: true,
    streaming: true,
    toolCalls: true,
    thinking: true,
    jsonOutput: true
  }
};

export const modelPresets = [
  { id: "deepseek-v4-flash", providerId: "deepseek", label: "DeepSeek V4 Flash", baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { id: "deepseek-v4-pro", providerId: "deepseek", label: "DeepSeek V4 Pro", baseURL: "https://api.deepseek.com", model: "deepseek-v4-pro" },
  { id: "gpt-4.1-mini", providerId: "openai", label: "OpenAI GPT-4.1 mini", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "compatible", providerId: "openai-compatible", label: "OpenAI-compatible", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "custom", providerId: "openai-compatible", label: "Custom", baseURL: "", model: "" }
] as const;

export const fallbackDeerFlowStatus: DeerFlowRuntimeStatus = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8000",
  assistantId: "lead_agent",
  reachable: false,
  runtimeProvider: "typescript",
  authState: "not_configured"
};

export const fallbackDeerFlowConfig: DeerFlowConfigOverview = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8000",
  skills: [],
  mcpServers: {}
};

export function resolvePreset(providerId: SettingsStatus["providerId"], baseURL: string, model: string) {
  return modelPresets.find((preset) => preset.providerId === providerId && preset.baseURL === baseURL && preset.model === model)?.id ?? "custom";
}
