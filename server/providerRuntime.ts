import OpenAI from "openai";
import type { AgentSettings } from "./agentCards.js";
import type { ProviderId } from "./types.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  name?: string;
  prefix?: boolean;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

export type ChatCompletionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: ChatCompletionTool[];
  tool_choice?: "none" | "auto" | "required";
  thinking?: {
    type: "enabled" | "disabled";
    reasoning_effort?: "high" | "max";
  };
  baseURLOverride?: string;
};

export type ChatCompletionResponse = {
  choices: Array<{
    finish_reason?: string | null;
    message: ChatMessage;
  }>;
  usage?: unknown;
};

export type ChatClient = {
  createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
};

export type ProviderCapabilities = {
  chatCompletions: boolean;
  streaming: boolean;
  toolCalls: boolean;
  thinking: boolean;
  jsonOutput: boolean;
  chatPrefixCompletion: boolean;
  supportsAssistantPrefix: boolean;
  betaBaseURL?: string;
};

export type ProviderProfile = {
  id: ProviderId;
  label: string;
  defaultBaseURL: string;
  defaultModel: string;
  modelAliases?: Record<string, { model: string; thinking?: ChatCompletionRequest["thinking"] }>;
  capabilities: ProviderCapabilities;
};

export type NormalizeInput = {
  modelSettings: AgentSettings["model"];
  messages: ChatMessage[];
  tools: ChatCompletionTool[];
  stream: boolean;
};

export const providerProfiles: Record<ProviderId, ProviderProfile> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    modelAliases: {
      "deepseek-chat": { model: "deepseek-v4-flash", thinking: { type: "disabled" } },
      "deepseek-reasoner": { model: "deepseek-v4-flash", thinking: { type: "enabled", reasoning_effort: "high" } }
    },
    capabilities: {
      chatCompletions: true,
      streaming: true,
      toolCalls: true,
      thinking: true,
      jsonOutput: true,
      chatPrefixCompletion: true,
      supportsAssistantPrefix: true,
      betaBaseURL: "https://api.deepseek.com/beta"
    }
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    capabilities: {
      chatCompletions: true,
      streaming: true,
      toolCalls: true,
      thinking: false,
      jsonOutput: true,
      chatPrefixCompletion: false,
      supportsAssistantPrefix: false
    }
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    capabilities: {
      chatCompletions: true,
      streaming: true,
      toolCalls: true,
      thinking: false,
      jsonOutput: true,
      chatPrefixCompletion: false,
      supportsAssistantPrefix: false
    }
  }
};

export function getProviderProfile(providerId?: string): ProviderProfile {
  if (providerId && providerId in providerProfiles) {
    return providerProfiles[providerId as ProviderId];
  }

  return providerProfiles.deepseek;
}

export function normalizeChatRequest(profile: ProviderProfile, input: NormalizeInput): ChatCompletionRequest {
  validateModelSettings(input.modelSettings);
  const alias = profile.modelAliases?.[input.modelSettings.model];
  const model = alias?.model ?? (input.modelSettings.model?.trim() || profile.defaultModel);
  const tools = profile.capabilities.toolCalls ? input.tools : [];

  const responseMode = input.modelSettings.responseMode ?? "normal";
  if (responseMode === "prefix_completion") {
    if (!profile.capabilities.chatPrefixCompletion || !profile.capabilities.supportsAssistantPrefix || !profile.capabilities.betaBaseURL) {
      throw new Error(`${profile.label} does not support prefix completion`);
    }
  }

  const request: ChatCompletionRequest = {
    model,
    messages: normalizeMessagesForResponseMode(profile, input.messages, responseMode),
    temperature: input.modelSettings.temperature,
    top_p: input.modelSettings.topP,
    stream: input.stream && profile.capabilities.streaming
  };

  if (responseMode === "prefix_completion") {
    request.baseURLOverride = profile.capabilities.betaBaseURL;
  }

  if (input.modelSettings.maxTokensEnabled) {
    request.max_tokens = input.modelSettings.maxTokens;
  }

  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = normalizeToolChoice(input.modelSettings.toolCallMode, profile);
  } else {
    request.tool_choice = "none";
  }

  if (profile.capabilities.thinking) {
    const explicitThinking: ChatCompletionRequest["thinking"] = input.modelSettings.thinkingMode
      ? {
          type: input.modelSettings.thinkingMode,
          reasoning_effort: normalizeReasoningEffort(input.modelSettings.reasoningEffort)
        }
      : undefined;
    request.thinking = explicitThinking ?? alias?.thinking;
  }

  return request;
}

export function normalizeToolChoice(mode: AgentSettings["model"]["toolCallMode"], profile?: ProviderProfile): "none" | "auto" | "required" {
  if (mode === "none") return "none";
  if (profile?.id === "deepseek") return "auto";
  if (mode === "function") return "required";
  return "auto";
}

export function createOpenAIChatClient(settings: { apiKey: string; baseURL: string }): ChatClient {
  return {
    async createChatCompletion(request) {
      const { baseURLOverride, ...wireRequest } = request;
      const client = new OpenAI({ apiKey: settings.apiKey, baseURL: baseURLOverride ?? settings.baseURL });
      return client.chat.completions.create(wireRequest as never) as Promise<ChatCompletionResponse>;
    }
  };
}

function normalizeMessagesForResponseMode(
  profile: ProviderProfile,
  messages: ChatMessage[],
  responseMode: AgentSettings["model"]["responseMode"]
): ChatMessage[] {
  if (responseMode !== "prefix_completion") return messages;
  if (!profile.capabilities.supportsAssistantPrefix) {
    throw new Error(`${profile.label} does not support assistant prefix messages`);
  }

  const normalized = messages.map((message) => ({ ...message, prefix: undefined }));
  const last = normalized.at(-1);
  if (last?.role === "assistant") {
    return [...normalized.slice(0, -1), { ...last, prefix: true }];
  }

  return [...normalized, { role: "assistant", content: "", prefix: true }];
}

function validateModelSettings(settings: AgentSettings["model"]) {
  if (settings.temperature < 0 || settings.temperature > 2) {
    throw new Error("Model temperature must be between 0 and 2");
  }
  if (settings.topP < 0 || settings.topP > 1) {
    throw new Error("Model topP must be between 0 and 1");
  }
  if (settings.maxTokensEnabled && (!Number.isFinite(settings.maxTokens) || settings.maxTokens <= 0)) {
    throw new Error("Model maxTokens must be a positive number when enabled");
  }
  if (!Number.isFinite(settings.maxToolCalls) || settings.maxToolCalls < 0) {
    throw new Error("Model maxToolCalls must be zero or greater");
  }
}

function normalizeReasoningEffort(effort: AgentSettings["model"]["reasoningEffort"]) {
  if (effort === "max" || effort === "xhigh") return "max";
  return "high";
}
