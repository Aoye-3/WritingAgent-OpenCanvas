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

export type DeerFlowRuntimeStatus = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  reachable: boolean;
  runtimeProvider: "deerflow" | "typescript";
  authState: "not_configured" | "setup_required" | "authenticated" | "auth_failed";
  lastError?: string;
};

export type DeerFlowConfigOverview = {
  enabled: boolean;
  baseUrl: string;
  skills: unknown[];
  mcpServers: Record<string, unknown>;
  lastError?: string;
};
