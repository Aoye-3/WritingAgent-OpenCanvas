import type { AgentBackendConfigOverview, AgentBackendRuntimeStatus, SettingsStatus } from "./types";
import { providerReferences } from "../../../shared/modelReferences";

export const fallbackStatus: SettingsStatus = {
  keyConfigured: false,
  providerId: "deepseek",
  providerLabel: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  systemPrompt: "You are OpenCanvas's writing assistant. Generate clear, usable text and organize useful output into canvas-ready content.",
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
  ...providerReferences.flatMap((provider) => provider.models.map((model) => ({
    id: `${provider.id}:${model.id}`,
    providerId: provider.id,
    label: `${provider.name} / ${model.name}`,
    baseURL: provider.apiHost,
    model: model.id
  }))),
  { id: "compatible", providerId: "openai-compatible", label: "OpenAI-compatible", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "custom", providerId: "openai-compatible", label: "Custom", baseURL: "", model: "" }
] as const;

export const fallbackAgentBackendStatus: AgentBackendRuntimeStatus = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8000",
  assistantId: "lead_agent",
  reachable: false,
  runtimeProvider: "typescript",
  authState: "not_configured"
};

export const fallbackAgentBackendConfig: AgentBackendConfigOverview = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8000",
  skills: [],
  mcpServers: {}
};

export function resolvePreset(providerId: SettingsStatus["providerId"], baseURL: string, model: string) {
  return modelPresets.find((preset) => preset.providerId === providerId && preset.baseURL === baseURL && preset.model === model)?.id ?? "custom";
}
