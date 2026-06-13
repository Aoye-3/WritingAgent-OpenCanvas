import type { ToolRef } from "../tools/catalog.js";

export type LocaleText = {
  en: string;
  zh: string;
};

export type AgentCard = {
  id: string;
  category: "chat";
  accent: "blue" | "green" | "orange" | "violet" | "rose";
  icon: "bot" | "pen" | "lines" | "mail" | "book" | "report" | "refresh";
  title: LocaleText;
  description: LocaleText;
  identityPrompt: string;
  skillRefs: string[];
  toolRefs: ToolRef[];
  outputContract: {
    type: string;
    defaultFormat: string;
  };
  settings?: AgentSettings;
};

export type AgentModelResponseMode = "normal" | "prefix_completion";

export type ConversationModelRuntimeSettings = {
  configuredModelApiId?: string;
  providerId: string;
  model: string;
  responseMode?: AgentModelResponseMode;
  temperature: number;
  topP: number;
  contextCount: number;
  maxTokens: number;
  maxTokensEnabled: boolean;
  streaming: boolean;
  toolCallMode: "auto" | "function" | "none";
  maxToolCalls: number;
  thinkingMode?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max" | "low" | "medium" | "xhigh";
};

export type ConversationModelRuntimeSettingsInput = Partial<Omit<ConversationModelRuntimeSettings, "configuredModelApiId" | "providerId" | "model">>;

export type AgentSettings = {
  prompt: {
    name: string;
    description: string;
    identityPrompt: string;
    outputType: string;
    outputFormat: string;
    skillRefs: string[];
  };
  tools: Partial<Record<ToolRef, boolean>>;
  knowledge: {
    enabled: boolean;
    scope: string;
    baseIds?: string[];
    documentCount?: number;
    threshold?: number;
    rerankEnabled?: boolean;
  };
  memory: {
    enabled: boolean;
  };
  quickMessages: string[];
  mcpRefs: string[];
};
