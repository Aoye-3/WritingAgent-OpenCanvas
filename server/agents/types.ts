import type { ToolRef } from "../tools/catalog.js";

export type LocaleText = {
  en: string;
  zh: string;
};

export type AgentCardField = {
  id: string;
  kind: "text" | "textarea" | "select" | "chips" | "segmented";
  label: LocaleText;
  options?: string[];
  placeholder: LocaleText;
  required?: boolean;
};

export type AgentCard = {
  id: string;
  category: "writing" | "education" | "summarise" | "rewrite";
  accent: "blue" | "green" | "orange" | "violet" | "rose";
  icon: "pen" | "lines" | "mail" | "book" | "report" | "refresh";
  title: LocaleText;
  description: LocaleText;
  identityPrompt: string;
  skillRefs: string[];
  toolRefs: ToolRef[];
  outputContract: {
    type: string;
    defaultFormat: string;
  };
  defaultValues: Record<string, string | string[]>;
  fields: AgentCardField[];
  settings?: AgentSettings;
};

export type AgentModelResponseMode = "normal" | "prefix_completion";

export type AgentSettings = {
  model: {
    providerId: "deepseek" | "openai" | "openai-compatible";
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
};
