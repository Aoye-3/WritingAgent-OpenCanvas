export type SettingsStatus = {
  keyConfigured: boolean;
  providerId: "deepseek" | "openai" | "openai-compatible";
  providerLabel: string;
  baseURL: string;
  model: string;
  systemPrompt: string;
  apiHealth: "online" | "offline";
  provider: "deepseek" | "openai" | "openai-compatible" | "mock";
  capabilities: {
    chatCompletions: boolean;
    streaming: boolean;
    toolCalls: boolean;
    thinking: boolean;
    jsonOutput: boolean;
  };
  modelAliases?: Record<string, unknown>;
  lastValidated?: string;
  lastError?: string;
};

export type SettingsValidationResponse = SettingsStatus & {
  ok: boolean;
  message: string;
};

export type SettingsSaveRequest = {
  providerId?: "deepseek" | "openai" | "openai-compatible";
  apiKey?: string;
  baseURL?: string;
  model?: string;
  systemPrompt?: string;
  confirmLocalKeyWrite?: boolean;
};
