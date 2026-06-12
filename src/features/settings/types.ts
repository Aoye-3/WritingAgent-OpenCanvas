export type SettingsStatus = {
  keyConfigured: boolean;
  providerId: string;
  providerLabel: string;
  baseURL: string;
  model: string;
  systemPrompt: string;
  apiHealth: "online" | "offline";
  provider: string | "mock";
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
  providerId?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  systemPrompt?: string;
  confirmLocalKeyWrite?: boolean;
};

export type CanvasSettings = {
  undoDepth: number;
};

export type ProviderApiConfigSummary = {
  providerId: string;
  providerLabel: string;
  keyConfigured: boolean;
  keyHint?: string;
  baseURL: string;
  defaultModel: string;
  enabled: boolean;
  updatedAt?: string;
};

export type ConfiguredModelApiSummary = {
  id: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelName: string;
  modelType?: string;
  keyConfigured: boolean;
  keyHint?: string;
  baseURL: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ProviderApiConfigListResponse = {
  activeProviderId?: string;
  configs: ProviderApiConfigSummary[];
};

export type ConfiguredModelApiListResponse = {
  activeConfigId?: string;
  configs: ConfiguredModelApiSummary[];
};

export type ProviderApiConfigSaveRequest = {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  enabled?: boolean;
  confirmLocalKeyWrite?: boolean;
};

export type ConfiguredModelApiSaveRequest = {
  providerId?: string;
  modelId?: string;
  modelName?: string;
  modelType?: string;
  apiKey?: string;
  baseURL?: string;
  enabled?: boolean;
  confirmLocalKeyWrite?: boolean;
};

export type ModelReference = {
  id: string;
  name: string;
  provider: string;
  group: string;
  modelType?: string;
  description?: string;
  ownedBy?: string;
  supportedEndpointTypes?: string[];
};

export type ProviderReference = {
  id: string;
  name: string;
  type: string;
  apiHost: string;
  anthropicApiHost?: string;
  defaultModel?: string;
  models: ModelReference[];
  websites?: {
    official?: string;
    apiKey?: string;
    docs?: string;
    models?: string;
  };
  enabled: boolean;
};

export type ProviderModelsResponse = {
  providerId: string;
  models: ModelReference[];
  source: "remote" | "static";
  error?: string;
};

export type AgentBackendRuntimeStatus = {
  enabled: boolean;
  baseUrl: string;
  assistantId: string;
  reachable: boolean;
  runtimeProvider: "agent-backend" | "typescript";
  authState: "not_configured" | "setup_required" | "authenticated" | "auth_failed";
  deploymentMode: "local" | "docker" | "external";
  sandboxProvider: string;
  lastError?: string;
};

export type AgentBackendConfigOverview = {
  enabled: boolean;
  baseUrl: string;
  skills: unknown[];
  mcpServers: Record<string, unknown>;
  lastError?: string;
};
