export type ModelReference = {
  id: string;
  name: string;
  provider: string;
  group: string;
  modelType?: "chat" | "embedding" | "vision" | "rerank" | "image" | "audio";
  supportsThinking?: boolean;
  description?: string;
  ownedBy?: string;
  supportedEndpointTypes?: string[];
};

export type ProviderReference = {
  id: string;
  name: string;
  type: "openai" | "ollama" | "gemini" | "new-api" | "anthropic" | "azure-openai" | "vertex-ai" | "aws-bedrock" | "openai-compatible" | string;
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
